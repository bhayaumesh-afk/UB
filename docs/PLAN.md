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
    serpapi.ts                  # Google Shopping via SerpApi (highest priority, if key set)
    gemini.ts                   # Gemini + Google Search grounding (2nd priority, if key set)
    mock.ts                     # deterministic sample data (no-key demo mode)
    index.ts                    # picks provider based on env: serpapi > gemini > mock
  trustedVendors.ts             # allow-listed retailer domains + isTrustedVendorUrl()
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

Provider precedence in `lib/providers/index.ts`: **SerpApi → Gemini → mock**, first
available key wins. Each is behind the common `PriceProvider` interface
(`lib/providers/types.ts`) so the API route and UI never know which one answered.

- **1st choice: SerpApi Google Shopping engine.** One licensed API call returns price,
  seller, and link across many retailers — the most structured, reliable source. Requires
  `SERPAPI_KEY` (free trial tier, paid beyond that). Not required to run the app.
- **2nd choice: Gemini + Google Search grounding.** Used when `SERPAPI_KEY` is unset but
  `GEMINI_API_KEY` is set. Gemini is a general-purpose model, not a shopping API, so this
  relies specifically on its **Google Search grounding tool**, which returns real, live
  search-result citations (`groundingMetadata.groundingChunks[].web.uri`) rather than the
  model's own text. Implementation is a **two-call pattern** (see `lib/providers/gemini.ts`
  design below), because Gemini does not reliably support combining tool use (grounding)
  with strict JSON response-schema output in a single call:
  1. Call `gemini-2.5-flash` (fallback `gemini-2.0-flash` if unavailable in the project)
     with `tools: [{ googleSearch: {} }]` and a prompt asking it to find current USD prices
     for the normalized product query at named reputable retailers. Read only the URLs in
     `groundingMetadata.groundingChunks[].web.uri` — never a URL the model prints in prose,
     since that could be fabricated.
  2. Call the model again, no tools, `responseMimeType: "application/json"` with a response
     schema matching `Offer[]`, passing in call 1's answer text plus the grounded URL list,
     instructing it to only use URLs from that list.
  3. Post-process every offer through `isTrustedVendorUrl()` (see Trusted vendors below) and
     drop anything that doesn't match. If a call fails, times out, or yields zero trusted
     offers, fall back to the mock provider for that request rather than erroring.
- **3rd choice / fallback: mock provider.** If neither key is set, `lib/providers/index.ts`
  serves deterministic sample offers and the UI shows a "Demo mode" banner. This means the
  app is fully deployable and demoable with zero paid keys.

## Trusted vendors

Every offer's `url`, from any provider, must resolve to an allow-listed retailer domain
before it's shown to the user — this is what makes "best price" links safe to click rather
than an arbitrary model- or scrape-sourced URL.

- `lib/trustedVendors.ts` exports `TRUSTED_VENDOR_DOMAINS` (e.g. amazon.com, walmart.com,
  target.com, bestbuy.com, ebay.com, costco.com, newegg.com, homedepot.com, apple.com,
  samsung.com, bhphotovideo.com, adorama.com — extend as needed) and
  `isTrustedVendorUrl(url): boolean`, matching the URL's hostname or any subdomain against
  the list.
- The Gemini provider filters through this before returning offers (its links come from
  open web search, so this is the safety gate). SerpApi and mock data are already scoped to
  known retailers but should be run through the same helper for consistency and defense in
  depth.
- UI: `OfferCard` shows a small "Verified retailer" badge next to the store name when the
  offer's domain is in the allow-list (in practice, always — untrusted ones are filtered
  out before they reach the UI, but the badge documents the guarantee to the user).

## Currency

All offers normalized to USD via a free, no-key FX API (e.g. `open.er-api.com`), rates
cached ~1 hour. Offers converted from another currency are labeled ("converted from EUR").

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=
SERPAPI_KEY=                    # optional — 1st choice for live prices if set
GEMINI_API_KEY=                 # optional — 2nd choice (Google Search-grounded pricing) if SERPAPI_KEY unset
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
- Every displayed offer link must pass `isTrustedVendorUrl()` — no offer from an
  unrecognized domain reaches the UI, regardless of which provider produced it.

## Roadmap

**Phase 1 — MVP (demo-deployable with zero paid keys)**
Input UI (3 tabs), `/api/identify` with Claude, mock price provider, results UI with
best-price highlight, deployed to Vercel, demo-mode banner.

**Phase 2 — Live pricing (done: SerpApi/mock; in progress: Gemini)**
SerpApi provider, currency conversion, caching, empty/error states, and rate limiting are
built and merged. Current work: add the Gemini-grounded provider and the trusted-vendor
allow-list described above, so the app has live pricing without requiring a paid SerpApi
signup — then complete the first production deploy to Vercel.

**Phase 3 — Stretch**
Price-history sparkline (needs a lightweight store, e.g. Supabase, for daily snapshots),
email price-drop alerts, affiliate link tagging, richer multi-candidate disambiguation,
mobile polish, basic analytics.

## Explicit non-goals (MVP)

- No native mobile app.
- No user accounts/auth.
- No direct HTML scraping of retailer sites (ToS/legal risk, fragile). Live prices come
  only from SerpApi's licensed API or from Gemini's Google Search grounding tool (real
  citations, not scraped HTML), and only for URLs on the trusted-vendor allow-list.

## Testing

- Unit tests (Vitest) for the provider abstraction, currency conversion, query
  normalization, and `isTrustedVendorUrl()` (including subdomain matches and rejection of
  look-alike/untrusted domains).
- Unit test for the Gemini provider's post-processing step using a fixture grounding
  response (mocked SDK call) — assert untrusted URLs are dropped and the two-call
  JSON-extraction path only uses URLs present in the fixture's grounding chunks.
- One Playwright end-to-end test covering the happy path: enter a product name → see a
  sorted results list with a highlighted best price.

## Deployment

- Vercel project connected to this repo/branch.
- Env vars set in Vercel project settings (see `.env.example`).
- `ANTHROPIC_API_KEY` required for identification; everything else optional (app degrades
  to demo mode without it, except identification itself needs the Anthropic key to function
  — without it, the Name/Description tabs can still do a naive pass-through search).
