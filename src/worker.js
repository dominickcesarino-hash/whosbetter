// Who's Better: Cloudflare Worker entry.
// /api/compare is handled by the stats function; everything else is the website in /public.
import { onRequestPost, onRequestGet } from "../functions/api/compare.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/compare") {
      const context = { request, env, waitUntil: (p) => ctx.waitUntil(p) };
      return request.method === "POST" ? onRequestPost(context) : onRequestGet(context);
    }
    return env.ASSETS.fetch(request);
  }
};
