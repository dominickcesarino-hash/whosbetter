// Who's Better: Cloudflare Worker entry.
// API routes live here; everything else is the website in /public.
import { onRequestPost as compare } from "./compare.js";
import { getUser, isAdmin } from "./auth.js";
import { touchUser, logComparison, logEvent, history, getSaved, unsave, adminStats } from "./db.js";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

const PAGES = { "/": "home", "/index.html": "home", "/stats": "stats", "/stats.html": "stats" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const bg = p => ctx.waitUntil(Promise.resolve(p).catch(e => console.error("background", e)));

    try {
      if (path === "/api/compare") {
        if (request.method !== "POST") return json(405, { error: "Method not allowed" });
        const user = await getUser(request, env);
        const res = await compare({ request, env, waitUntil: p => ctx.waitUntil(p) });
        if (res.status !== 200) return res;
        const body = await res.json();
        if (body.error || !body.stats) return json(200, body);
        if (user) { await touchUser(env, user).catch(() => {}); body.savedId = await logComparison(env, user, body).catch(() => null); }
        else bg(logComparison(env, null, body));
        return json(200, body);
      }

      if (path === "/api/me") {
        const user = await getUser(request, env);
        if (!user) return json(401, { error: "Please sign in." });
        await touchUser(env, user);
        return json(200, { user: { email: user.email, name: user.name }, admin: isAdmin(user, env), storage: !!env.DB });
      }

      if (path === "/api/history") {
        const user = await getUser(request, env);
        if (!user) return json(401, { error: "Please sign in." });
        if (request.method === "GET") {
          const id = url.searchParams.get("id");
          if (id) {
            const r = await getSaved(env, user, Number(id));
            return r ? json(200, r) : json(404, { error: "Not found" });
          }
          return json(200, { items: await history(env, user) });
        }
        if (request.method === "DELETE") {
          const id = url.searchParams.get("id");
          await unsave(env, user, id === "all" ? "all" : Number(id));
          return json(200, { ok: true });
        }
        return json(405, { error: "Method not allowed" });
      }

      if (path === "/api/track" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (b.type === "league" && typeof b.detail === "string") bg(logEvent(env, "league", b.detail, null));
        return json(200, { ok: true });
      }

      if (path === "/api/admin") {
        const user = await getUser(request, env);
        if (!isAdmin(user, env)) return json(403, { error: "Admins only." });
        const stats = await adminStats(env);
        return stats ? json(200, stats) : json(500, { error: "The database isn't connected yet." });
      }

      if (path === "/api/_espntest") { // TEMP: which ESPN endpoints can the Worker reach?
        const urls = ["https://site.web.api.espn.com/apis/search/v2?query=LeBron%20James&limit=5",
          "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/stats",
          "https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/stats",
          "https://site.api.espn.com/apis/search/v2?query=LeBron%20James&limit=5",
          "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/1966/statistics",
          "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/1966",
          "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/overview"];
        const out = {};
        for (const u of urls) for (const ua of ["", "WhosBetter/1.0"]) {
          try { const r = await fetch(u, { headers: ua ? { "User-Agent": ua } : {} }); out[(ua ? "UA " : "") + u] = r.status; } catch (e) { out[u] = String(e); }
        }
        return json(200, out);
      }
      if (path.startsWith("/api/")) return json(404, { error: "Not found" });

      if (request.method === "GET" && PAGES[path]) bg(logEvent(env, "view:" + PAGES[path], "", null));
    } catch (e) {
      console.error(e);
      return json(500, { error: "Something went wrong. Please try again." });
    }
    return env.ASSETS.fetch(request);
  }
};
