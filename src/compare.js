// Who's Better: the AI comparison (answers POST /api/compare, routed from src/worker.js).
// Set GEMINI_API_KEY in Cloudflare: your Worker > Settings > Variables and Secrets.
//
// How it works (all free):
//  1. Gemini works out who is being compared.
//  2. We fetch each side's career stats from ESPN and their Wikipedia page.
//  3. Gemini builds the card using ONLY those pages, quoting the exact text each number came from.
//  4. A number gets a ✓ only if that quote really appears in the source page (checked by code, not AI).
// Optional: set COMPARE_MODEL in Cloudflare to choose a different model.
import { gather, verify } from "./sources.js";

let MODEL = "gemini-flash-lite-latest"; // Google's current fast Flash-Lite model (quick and generous free limits)
const MAX_QUERY = 120;
const CACHE_SECONDS = 6 * 60 * 60;     // same matchup within 6 hours reuses the checked result

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

const IDENTIFY = (query, today) => `Today is ${today}. A user of a sports "who's better" site typed: "${query}"
Work out the two athletes or two teams being compared. It can be any sport.
Reply with JSON only:
{"sport": "Basketball", "kind": "athletes", "a": {"name": "LeBron James", "wiki": "LeBron James"}, "b": {"name": "Michael Jordan", "wiki": "Michael Jordan"}}
"kind" is "athletes" or "teams". "name" is the full, correctly spelled name. "wiki" is the exact English Wikipedia article title.
If it is not a comparison of two sports people or teams, reply with JSON only: {"error": "short friendly reason"}`;

const BUILD = (query, today, sport, A, B) => `Today is ${today}. Build a fair "who's better" comparison for: "${query}" (${sport}).
Side "a" is ${A.name}. Side "b" is ${B.name}.

Use ONLY the source pages below. Do not use your own memory for any number.
${pages("a", A)}
${pages("b", B)}

Pick 6 to 8 stats that matter most in ${sport} and that appear in the sources for BOTH sides. Include championships/titles and major awards when the sources list them (e.g. rings and MVPs in the NBA, league titles and Ballon d'Ors in soccer, Grand Slams in tennis, world championships and race wins in F1). Only use stats where higher or lower is clearly better (no trivia like founding year, height, age or jersey number). Prefer ESPN for career stats (it is the most up to date) and Wikipedia for titles and awards.
For every value, copy a short exact quote (3 to 12 words) from that side's source that contains the number, e.g. "PTS 26.7" or "4× NBA champion". The quote must appear word for word in the source.

Reply with JSON only, in this shape:
{
  "a": {"info": "Position · team(s) · years", "active": true},
  "b": {"info": "Position · team(s) · years", "active": false},
  "stats": [
    {"label": "Points per game", "note": "Career, regular season", "a": "26.7", "a_quote": "PTS 26.7", "b": "30.1", "b_quote": "PTS 30.1", "better": "higher"}
  ],
  "verdict": "2 to 3 sentences: who is better and why, fair to both, mentioning the deciding numbers.",
  "winner": "a"
}
Values are short strings (e.g. "6", "26.7", "1,124"). "better" is "higher", "lower" (e.g. ERA, goals against) or "none". "winner" is "a", "b" or "even".`;

function pages(side, s) {
  if (!s.sources.length) return `\n[${side}] No source pages were found for ${s.name}.`;
  return s.sources.map(p => `\n===== SOURCE for side "${side}" (${s.name}): ${p.title} =====\n${p.text}`).join("\n");
}

// Pull the first JSON object out of a model reply
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

const str = (v, n) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").trim().slice(0, n);

// Ask Gemini. Falls back to other models if one is busy or out of free quota.
async function ask(key, prompt, maxTokens) {
  const models = [...new Set([MODEL, "gemini-flash-lite-latest", "gemini-flash-latest"])];
  const started = Date.now();
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: "application/json" }
  });
  const errs = [];
  for (const m of models) {
    if (Date.now() - started > 50000) break;                     // don't keep the visitor waiting forever
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: payload, signal: AbortSignal.timeout(45000) });
    } catch (e) { errs.push(`${m}: timed out`); continue; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini error", m, r.status, JSON.stringify(data).slice(0, 300));
      errs.push(`${m}: ${r.status} ${str(data.error && data.error.message, 90)}`);
      continue;
    }
    const cand = (data.candidates || [])[0] || {};
    const text = ((cand.content && cand.content.parts) || []).map(p => p.thought ? "" : (p.text || "")).join("").trim();
    if (text) return text;
    errs.push(`${m}: empty reply`);
  }
  throw { quota: errs.length && errs.every(e => /: 429 /.test(e)), msg: errs.join(" | ") };
}

async function handle(req, env, ctx) {
  if (env.COMPARE_MODEL) MODEL = env.COMPARE_MODEL;
  const key = env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "Who's Better isn't set up yet: the API key is missing." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const query = str(body.q, MAX_QUERY).replace(/\s+/g, " ");
  if (query.length < 3) return json(400, { error: "Type two names, like \"LeBron or Jordan?\"" });

  // Cache by the normalized question (same matchup within 6 hours reuses the checked result)
  const norm = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const cacheKey = new Request("https://whosbetter.cache/v3/" + encodeURIComponent(norm));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && body.fresh !== true) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return json(200, { ...(await hit.json()), cached: true });
  }

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  try {
    // 1) Who is being compared?
    const id = parseJSON(await ask(key, IDENTIFY(query, today), 400));
    if (!id) return json(502, { error: "Couldn't understand that one. Try two full names, like \"LeBron James or Michael Jordan\"." });
    if (id.error) return json(200, { error: str(id.error, 200) });
    if (!id.a || !id.b || !id.a.name || !id.b.name) return json(200, { error: "Type two names, like \"LeBron or Jordan?\"" });
    const sport = str(id.sport, 40) || "Sports";
    const side = s => ({ name: str(s.name, 80), wiki: str(s.wiki, 120) });

    // 2) Fetch ESPN + Wikipedia for both sides
    // ESPN data the browser fetched for us (checked and size-limited)
    const browserEspn = (Array.isArray(body.espn) ? body.espn : []).slice(0, 2)
      .filter(x => x && typeof x.text === "string" && typeof x.name === "string" && /^https:\/\/www\.espn\.com\//.test(String(x.url)))
      .map(x => ({ name: str(x.name, 80), url: str(x.url, 200), text: x.text.slice(0, 3500) }));
    const [A, B] = await Promise.all([gather(side(id.a), sport, browserEspn), gather(side(id.b), sport, browserEspn)]);
    for (const s of [A, B]) if (!s.sources.length)
      return json(200, { error: `Couldn't find stats for ${s.name}. Check the spelling or try their full name.` });

    console.log("sources", JSON.stringify([...A.notes, ...B.notes]));
    // 3) Build the card from those pages only
    const d = parseJSON(await ask(key, BUILD(query, today, sport, A, B), 3000));
    if (!d || !Array.isArray(d.stats) || !d.stats.length)
      return json(502, { error: "Couldn't put the stats together this time. Please try again." });

    // 4) Check every number against its quote in the real source page
    const used = new Map();
    const stats = d.stats.slice(0, 10).map(s => {
      const out = { label: str(s.label, 40), note: str(s.note, 60), a: str(s.a, 24), b: str(s.b, 24),
        better: ["higher", "lower", "none"].includes(s.better) ? s.better : "higher", a_ok: false, b_ok: false, source: "" };
      const va = verify(out.a, s.a_quote, A.sources), vb = verify(out.b, s.b_quote, B.sources);
      if (va) { out.a_ok = true; used.set(va.url, va); }
      if (vb) { out.b_ok = true; used.set(vb.url, vb); }
      out.source = [va, vb].filter(Boolean).map(v => v.id === "espn" ? "ESPN" : "Wikipedia").filter((x, i, a) => a.indexOf(x) === i).join(" & ");
      return out;
    }).filter(s => s.label && s.a && s.b && (s.a_ok || s.b_ok)); // drop stats that couldn't be checked at all

    if (stats.length < 2)
      return json(200, { error: "Couldn't find enough verified stats for both sides. Try full names, like \"LeBron James or Michael Jordan\"." });

    const out = {
      query,
      sport,
      kind: id.kind === "teams" ? "teams" : "athletes",
      a: { name: A.name, info: str(d.a && d.a.info, 120), active: !!(d.a && d.a.active) },
      b: { name: B.name, info: str(d.b && d.b.info, 120), active: !!(d.b && d.b.active) },
      stats,
      verdict: str(d.verdict, 600),
      winner: ["a", "b", "even"].includes(d.winner) ? d.winner : "even",
      asOf: today,
      verified: true,
      sources: [...A.sources, ...B.sources].map(s => ({ title: s.title, url: s.url, used: used.has(s.url) })),
      espnUsed: [...A.sources, ...B.sources].some(s => s.id === "espn")
    };

    // Results that used browser-supplied ESPN data are never shared with other visitors
    const shareable = ![...A.sources, ...B.sources].some(s => s.viaBrowser);
    const res = json(200, out, { "Cache-Control": shareable ? `public, max-age=${CACHE_SECONDS}` : "no-store" });
    if (shareable && cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
    return res;
  } catch (e) {
    if (e && e.quota) return json(429, { error: "Who's Better has used up its free AI lookups for now. Please try again later." });
    console.error(e);
    return json(502, { error: "Couldn't reach the stats service. Please try again.", detail: e && e.msg ? `Gemini: ${e.msg}` : String(e && e.message || e).slice(0, 200) });
  }
}

// Called from src/worker.js for POST /api/compare
export const onRequestPost = (context) => handle(context.request, context.env, context);
