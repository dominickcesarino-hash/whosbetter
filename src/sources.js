// Free, verifiable stat sources for Who's Better: ESPN (career stats) and Wikipedia (careers, honours, records).
// Both are fetched fresh for each new comparison, so numbers stay current.

const UA = "WhosBetter/1.0 (https://whosbetter.sportsdebate.workers.dev; sports comparison site)";
const SPORT_IDS = { 40: "basketball", 20: "football", 10: "baseball", 70: "hockey", 600: "soccer", 850: "tennis", 2000: "racing" };
const STATS_LEAGUES = ["nba", "wnba", "nfl", "mlb", "nhl", "mens-college-basketball", "college-football"];
const MAX_WIKI = 13000;
const MAX_ESPN = 3500;

// Fetch JSON, keeping a copy in Cloudflare's cache for a few hours (kind to Wikipedia/ESPN, and faster)
async function getJSON(url, ttl = 6 * 3600) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url);
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit.json(); }
  const r = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const text = await r.text();
  if (cache) await cache.put(key, new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` } })).catch(() => {});
  return JSON.parse(text);
}

// ---------- ESPN ----------
async function espnFind(name, sportHint) {
  const d = await getJSON(`https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=5`);
  const hits = [];
  for (const r of d.results || []) if (r.type === "player" || r.type === "team") hits.push(...(r.contents || []).map(c => ({ ...c, kind: r.type })));
  if (!hits.length) return null;
  const hint = (sportHint || "").toLowerCase();
  const sportOf = h => SPORT_IDS[(String(h.uid).match(/s:(\d+)/) || [])[1]] || "";
  // Prefer a hit in the right sport
  const best = hits.find(h => hint && (sportOf(h) && hint.includes(sportOf(h).replace("football", hint.includes("soccer") ? "soccer" : "football")))) || hits[0];
  const web = (best.link && best.link.web) || "";
  const league = (web.match(/espn\.com\/([a-z-]+)\//) || [])[1] || "";
  const id = (String(best.uid).match(/[at]:(\d+)/) || [])[1];
  return { name: best.displayName, kind: best.kind, sport: sportOf(best), league, id, url: web, team: best.subtitle || "" };
}

// Flatten ESPN career stat tables into short readable lines Gemini can quote exactly.
async function espnStats(hit) {
  if (!hit || hit.kind !== "player" || !STATS_LEAGUES.includes(hit.league) || !hit.id) return "";
  const d = await getJSON(`https://site.api.espn.com/apis/common/v3/sports/${hit.sport}/${hit.league}/athletes/${hit.id}/stats`);
  const lines = [];
  for (const c of d.categories || []) {
    const labels = c.labels || [], totals = c.totals || [];
    if (!labels.length || !totals.length) continue;
    lines.push(`${c.displayName || c.name} (career): ` + labels.map((l, i) => `${l} ${totals[i]}`).join(" | "));
    // Glossary-style names help the model map abbreviations
    if (c.displayNames) lines.push(`  (${labels.map((l, i) => `${l} = ${c.displayNames[i]}`).join("; ")})`);
  }
  return lines.join("\n").slice(0, MAX_ESPN);
}

// ---------- Wikipedia ----------
async function wikiPage(title, search) {
  const base = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*";
  let t = title;
  if (!t && search) {
    const s = await getJSON(`${base}&action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(search)}`);
    t = s.query && s.query.search && s.query.search[0] && s.query.search[0].title;
  }
  if (!t) return null;
  let d = await getJSON(`${base}&action=parse&prop=wikitext&redirects=1&page=${encodeURIComponent(t)}`).catch(() => null);
  if ((!d || d.error) && search && title) return wikiPage(null, search);
  if (!d || !d.parse) return null;
  return { title: d.parse.title, url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(d.parse.title.replace(/ /g, "_")), text: wikiExtract(d.parse.wikitext || "") };
}

// Keep the infobox, the opening summary, and stats / honours / records sections, each with its own size budget.
function wikiExtract(w) {
  w = w.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const parts = [];
  const ib = w.indexOf("{{Infobox");
  let ibEnd = 0;
  if (ib >= 0) {
    let depth = 0;
    for (let i = ib; i < w.length - 1; i++) {
      if (w[i] === "{" && w[i + 1] === "{") { depth++; i++; }
      else if (w[i] === "}" && w[i + 1] === "}") { depth--; i++; if (depth === 0) { ibEnd = i + 1; break; } }
    }
    const box = clean(w.slice(ib, ibEnd)).split("\n")
      .filter(l => !/^\s*\|\s*(image|caption|alt|signature|logo|website|module_|medaltemplates|youth|pronunciation|honorific|upright)/i.test(l) && !/\{\{Medal/i.test(l))
      .join("\n");
    parts.push(box.slice(0, 5000));
  }
  const firstHead = w.search(/\n==[^=]/);
  parts.push(clean(w.slice(ibEnd, firstHead > ibEnd ? firstHead : ibEnd + 4000)).trim().slice(0, 1800));
  // Only top-level (== Heading ==) sections, so career-story subsections don't crowd out the stats
  const sec = /\n(==)\s*([^=\n]*(statistic|honou?r|award|achievement|record|career summary|accomplishment|titles|trophies|results)[^=\n]*)\s*==(?!=)/gi;
  let m, used = parts.join("").length;
  while ((m = sec.exec(w)) && used < MAX_WIKI) {
    const level = m[1].length;
    const rest = w.slice(m.index + m[0].length);
    const next = rest.search(new RegExp(`\\n={2,${level}}[^=]`));
    const body = clean(m[2] + "\n" + (next > 0 ? rest.slice(0, next) : rest)).slice(0, 4500);
    parts.push(body); used += body.length;
    if (next > 0) sec.lastIndex = m.index + m[0].length + next;
  }
  return parts.join("\n\n").slice(0, MAX_WIKI);
}

function clean(t) {
  return t
    .replace(/\{\{(?:nbay|nhly|mlby|nfly|nasg)\|(\d{4})[^}]*\}\}/gi, "$1")
    .replace(/\{\{(?:flagicon|flag|small|nowrap|sortname|abbr)\|([^}|]*)[^}]*\}\}/gi, "$1")
    .replace(/\{\{(?:cite|citation|efn|refn|sfn|harvnb)[^{}]*\}\}/gi, "")
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/(?:style|bgcolor|colspan|rowspan|class|align|scope)="[^"]*"\s*\|?/gi, "").replace(/\{\{(?:double-dagger|dagger|bold|abbr|tooltip)[^}]*\}\}/gi, "").replace(/\|\s*\|/g, "|").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

// Gather everything for one side of the comparison.
const nameKey = n => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").trim();

// "browserEspn" is ESPN data the visitor's browser fetched (ESPN often blocks Cloudflare's servers).
// It's only used when the server couldn't reach ESPN and the player's name matches.
export async function gather(side, sport, browserEspn = []) {
  const notes = [];
  const [hit, wiki] = await Promise.all([
    espnFind(side.name, sport).catch(e => { notes.push("espn search: " + e.message); return null; }),
    wikiPage(side.wiki, `${side.name} ${sport || ""}`).catch(e => { notes.push("wikipedia: " + e.message); return null; })
  ]);
  if (hit) notes.push(`espn: ${hit.kind} ${hit.sport}/${hit.league} ${hit.id}`);
  const espn = hit ? await espnStats(hit).catch(e => { notes.push("espn stats: " + e.message); return ""; }) : "";
  const sources = [];
  if (espn) sources.push({ id: "espn", title: `ESPN — ${hit.name} career stats`, url: hit.url, text: espn });
  else {
    const b = browserEspn.find(x => x && nameKey(x.name) && (nameKey(x.name) === nameKey(side.name) || nameKey(x.name) === nameKey(hit && hit.name)));
    if (b) { sources.push({ id: "espn", title: `ESPN — ${b.name} career stats`, url: b.url, text: b.text, viaBrowser: true }); notes.push("espn: from browser"); }
  }
  if (wiki && wiki.text) sources.push({ id: "wiki", title: `Wikipedia — ${wiki.title}`, url: wiki.url, text: wiki.text });
  return { name: (hit && hit.name) || side.name, team: hit && hit.team, sources, notes };
}

// ---------- Verification ----------
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const norm = s => String(s || "").toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g, w => WORDS[w]).replace(/[–—]/g, "-").replace(/[×]/g, "x").replace(/[^a-z0-9.%+\-x ]+/g, " ").replace(/\s+/g, " ").trim();
const digits = s => (String(s).match(/\d[\d,]*\.?\d*/g) || []).map(x => x.replace(/,/g, ""));

// A value is verified only if the model's quote really appears in that side's source text
// and the quote contains the same number shown on the card.
export function verify(value, quote, sources) {
  const q = norm(quote);
  const want = digits(value);
  if (!q || q.length < 3 || !want.length) return null;
  const qNums = digits(norm(quote));
  if (!want.every(n => qNums.some(x => parseFloat(x) === parseFloat(n)))) return null;
  for (const s of sources) {
    const hay = norm(s.text);
    if (new RegExp("(?:^|[^a-z0-9.])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(hay)) return s;
    // Allow tiny formatting differences: the quote's words in the same order, with only short gaps between them
    const words = q.split(" ").filter(Boolean).slice(0, 16);
    const re = new RegExp("(?:^|[^a-z0-9.])" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^]{0,12}?"));
    if (re.test(hay)) return s;
  }
  return null;
}

export const _wikiExtract = wikiExtract; // for tests
