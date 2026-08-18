# PriceScout — Best Price Finder

## What it does

User provides a **product image**, a **product name**, or a **free-text description**. The app
identifies the product and returns the **best available price in USD** across online stores,
sorted low-to-high, with a direct "buy" link.

## User flow

1. User picks one of three input tabs: Image / Name / Description.
2. Frontend sends the input to `POST /api/identify`.
   - Image or description → Claude (vision-capable, `claude-sonnet-5`) extracts a normalized
     product query: `{ title, brand?, category?, confidence, candidates?[] }`.
   - Name → light normalization pass (typo/brand cleanup) through the same endpoint.
   - If confidence is low, the UI shows up to 3 candidate matches for the user to pick from
     before searching prices.
3. Frontend sends the normalized query to `POST /api/search-prices`.
   - Provider layer queries one or more price sources, converts everything to USD, sorts
     ascending, and returns a list of offers.
4. Results UI: a highlighted "Best Price" card at the top, plus the full offer list below
   (store name, price, shipping note if available, "View Deal" link).

## Architecture

**Single full-stack app** — Next.js 14 (App Router, TypeScript, Tailwind), deployed to Vercel.
No separate backend service needed for the MVP; API routes are serverless functions.

```
/app
  /page.tsx                     # 3-tab input UI
  /results/page.tsx             # results view
  /api/identify/route.ts        # POST: image|text -> normalized query
  /api/search-prices/route.ts   # POST: query -> Offer[]
/components
  ImageUploader.tsx
  SearchTabs.tsx
  ResultsList.tsx
  OfferCard.tsx
  BestPriceBanner.tsx
  CandidatePicker.tsx
/lib
  anthropic.ts                  # Claude client wrapper (identify + normalize)
  providers/
    types.ts                    # PriceProvider interface, Offer type
    serpapi.ts                  # Google Shopping via SerpApi (primary)
    mock.ts                     # deterministic sample data (no-key demo mode)
    index.ts                    # picks provider based on env, w/ fallback to mock
  currency.ts                   # FX conversion to USD, cached
  cache.ts                      # Upstash Redis client (optional) / in-memory LRU fallback
  ratelimit.ts                  # basic IP-based limiter for /api/*
/types
  index.ts
/tests
  providers.test.ts
  normalize.test.ts
  e2e/happy-path.spec.ts        # Playwright
docs/PLAN.md                    # this file
.env.example
```

## Data contracts

```ts
type Offer = {
  store: string;
  price: number;          // USD, after conversion
  originalCurrency?: string;
  url: string;
  thumbnail?: string;
  shipping?: string;
  rating?: number;
};

type IdentifyResult = {
  query: string;           // normalized search string
  title: string;
  brand?: string;
  category?: string;
  confidence: number;      // 0-1
  candidates?: IdentifyResult[]; // present when confidence is low
};
```

## Price source strategy

- **Primary: SerpApi Google Shopping engine.** One licensed API call returns price, seller,
  and link across many retailers — avoids the legal/fragility risk of scraping individual
  store HTML. Requires a `SERPAPI_KEY` (has a free trial tier; paid beyond that).
- **Fallback: mock provider.** If `SERPAPI_KEY` is unset, `lib/providers/index.ts` serves
  deterministic sample offers and the UI shows a "Demo mode — connect SERPAPI_KEY for live
  prices" banner. This means the app is fully deployable and demoable with zero paid keys.
- Provider is behind a common interface (`lib/providers/types.ts`) so a second/alternate
  source can be added later without touching the API route or UI.

## Currency

All offers normalized to USD via a free, no-key FX API (e.g. `open.er-api.com`), rates
cached ~1 hour. Offers converted from another currency are labeled ("converted from EUR").

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=
SERPAPI_KEY=                    # optional — mock provider used if unset
UPSTASH_REDIS_REST_URL=         # optional — in-memory cache used if unset
UPSTASH_REDIS_REST_TOKEN=       # optional
NEXT_PUBLIC_APP_NAME=PriceScout
```

## Non-functional requirements

- No auth/accounts for MVP — stateless, no user data stored.
- Basic IP rate limiting on `/api/*` to control cost and abuse.
- Graceful failure: provider timeout/error falls back to mock data with a visible notice
  rather than a blank error page.
- Never log API keys or raw request bodies containing images.
- Client compresses/resizes images (~1MB cap) before upload.

## Roadmap

**Phase 1 — MVP (demo-deployable with zero paid keys)**
Input UI (3 tabs), `/api/identify` with Claude, mock price provider, results UI with
best-price highlight, deployed to Vercel, demo-mode banner.

**Phase 2 — Live pricing**
Wire real SerpApi provider, currency conversion, caching, empty/error states, rate limiting.

**Phase 3 — Stretch**
Price-history sparkline (needs a lightweight store, e.g. Supabase, for daily snapshots),
email price-drop alerts, affiliate link tagging, richer multi-candidate disambiguation,
mobile polish, basic analytics.

## Explicit non-goals (MVP)

- No native mobile app.
- No user accounts/auth.
- No direct HTML scraping of retailer sites (ToS/legal risk, fragile) — SerpApi is the
  price source of record.

## Testing

- Unit tests (Vitest) for the provider abstraction, currency conversion, and query
  normalization logic.
- One Playwright end-to-end test covering the happy path: enter a product name → see a
  sorted results list with a highlighted best price.

## Deployment

- Vercel project connected to this repo/branch.
- Env vars set in Vercel project settings (see `.env.example`).
- `ANTHROPIC_API_KEY` required for identification; everything else optional (app degrades
  to demo mode without it, except identification itself needs the Anthropic key to function
  — without it, the Name/Description tabs can still do a naive pass-through search).
