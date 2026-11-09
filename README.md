# Who's Better?

Settle any sports debate. Type something like "LeBron or Jordan?" and get a side-by-side card with stats (points, rebounds, assists, rings, MVPs, or whatever matters in that sport) plus a short verdict. Works for any sport, for athletes or teams.

- `public/index.html` is the page.
- `functions/api/compare.js` is the small server piece that keeps your API key secret.
- `src/worker.js` and `wrangler.jsonc` run it as a Cloudflare Worker.

## Verified, up-to-date stats

Gemini looks the stats up with Google Search, then a second, separate Google search fact-checks every number:
- ✓ = confirmed
- corrected numbers are swapped in automatically
- ? = couldn't be confirmed

Sources are listed under each card so anyone can double-check.

## Setup ($0, no credit card) on Cloudflare Workers

1. Get a free Gemini API key at aistudio.google.com/apikey (don't add billing).
2. In Cloudflare: Workers & Pages > Create > Import a repository, and pick this `whosbetter` repository. Keep the deploy command `npx wrangler deploy`.
3. In the Worker, go to Settings > Variables and Secrets, add a **Secret** named `GEMINI_API_KEY` with your key.
4. Your site is at whosbetter.<your-subdomain>.workers.dev.

Each comparison uses 2 Google-grounded Gemini requests (the free tier has a daily limit). Results are cached for 6 hours on a custom domain.
Optional: set `COMPARE_MODEL` to choose a different model (default `gemini-2.5-flash`).
