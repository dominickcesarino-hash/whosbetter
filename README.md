# Who's Better?

Settle any sports debate. Type something like "LeBron or Jordan?" and get a side-by-side card with stats (points, rebounds, assists, rings, MVPs, or whatever matters in that sport) plus a short verdict. Works for any sport, for athletes or teams.

- `index.html` is the page.
- `functions/api/compare.js` is the small server piece that keeps your API key secret.

## Verified, up-to-date stats

Gemini looks the stats up with Google Search, then a second, separate Google search fact-checks every number:
- ✓ = confirmed
- corrected numbers are swapped in automatically
- ? = couldn't be confirmed

Sources are listed under each card so anyone can double-check.

## Setup ($0, no credit card) on Cloudflare Pages

1. Get a free Gemini API key at aistudio.google.com (don't add billing). You can reuse the same key as another site.
2. In Cloudflare: Workers & Pages > Create > Pages > Connect to Git, and pick this `whosbetter` repository.
3. Framework preset: None. Build command: leave empty. Output directory: `/`.
4. Deploy. Name the project `whosbetter` to get whosbetter.pages.dev.
5. In the project, go to Settings > Variables and Secrets, add `GEMINI_API_KEY`, then redeploy.

Each comparison uses 2 Google-grounded Gemini requests (the free tier has a daily limit). Results are cached for 6 hours on a custom domain.
Optional: set `COMPARE_MODEL` to choose a different model (default `gemini-2.5-flash`).
