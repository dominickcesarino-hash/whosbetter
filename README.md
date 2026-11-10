# Who's Better?

Settle any sports debate. Type something like "LeBron or Jordan?" and get a side-by-side card with stats (points, rebounds, assists, rings, MVPs, or whatever matters in that sport) plus a short verdict. Works for any sport, for athletes or teams.

- `public/index.html` is the Compare page (AI comparisons).
- `public/stats.html` is the Stats page: live standings and player stats for 250+ leagues (data from ESPN), sortable by any column.
- `public/admin.html` is the admin dashboard (only the owner can see the numbers).
- `public/common.js` / `common.css` are the shared header, sign-in and "My comparisons" drawer.
- `src/worker.js` routes the API; `src/compare.js` is the AI comparison; `src/db.js` is the database; `src/auth.js` checks sign-ins.
- `wrangler.jsonc` runs it all as one Cloudflare Worker with a free D1 database (created automatically on deploy).

## Accounts

Sign-in uses Firebase Authentication (Google or email + password), the same Firebase project as Quorvyn.
Signed-in users' comparisons are saved to "My comparisons".
In Firebase (Authentication > Settings > Authorized domains), add this site's domain so Google sign-in works.

## Admin dashboard (`/admin`)

Shows comparisons sent, accounts made, most looked-up sports, athletes and teams, most viewed leagues, page views and the latest comparisons.
Only accounts whose verified email matches the `ADMIN_EMAIL` secret (set in Cloudflare) can see it.

## Verified, up-to-date stats (free)

For each comparison:
1. Gemini works out who is being compared.
2. The site fetches each side's career stats from ESPN and their Wikipedia page (cached for a few hours).
3. Gemini builds the card using only those pages, quoting the exact text each number came from.
4. Code (not AI) checks that every quote really appears in the source page and contains the same number. Matches get a ✓, anything else gets a ?, and stats that can't be checked on either side are left out.

Sources are listed under each card so anyone can double-check.

## Setup ($0, no credit card) on Cloudflare Workers

1. Get a free Gemini API key at aistudio.google.com/apikey (don't add billing).
2. In Cloudflare: Workers & Pages > Create > Import a repository, and pick this `whosbetter` repository. Keep the deploy command `npx wrangler deploy`.
3. In the Worker, go to Settings > Variables and Secrets and add two **Secrets**: `GEMINI_API_KEY` (your key) and `ADMIN_EMAIL` (the email you sign in with).
4. Your site is at whosbetter.<your-subdomain>.workers.dev.

Each comparison uses 2 regular Gemini requests (no Google Search needed, so it works on the free tier). Results are cached for 6 hours on a custom domain.
Optional: set `COMPARE_MODEL` to choose a different model (default `gemini-2.5-flash`).
