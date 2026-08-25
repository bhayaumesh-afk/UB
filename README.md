# PriceScout

Find the best price for a product from a photo, a product name, or a free-text
description. Built with Next.js 14 (App Router, TypeScript, Tailwind CSS), the
Anthropic SDK, and a pluggable live-price provider layer.

## How it works

1. **Identify** — `POST /api/identify` sends your image/name/description to
   Claude (`claude-sonnet-5`, vision-capable) and gets back a normalized
   shopping query: `{ query, title, brand?, category?, confidence, candidates?[] }`.
   If confidence is low, up to 3 candidates are returned for you to pick from.
2. **Search** — `POST /api/search-prices` sends the normalized query to the
   active price provider and returns `Offer[]`, sorted ascending by USD price.
3. **Compare** — the UI highlights the cheapest offer as the "Best price" card,
   with the full ranked list below.

## Demo mode vs. live prices

The app works out of the box with **only `ANTHROPIC_API_KEY` set**:

- Product identification (photo/name/description → normalized query) uses Claude.
- Price search runs in **demo mode**: a deterministic mock price provider
  returns sample offers across a few product categories, and a banner reads
  *"Demo mode — connect SERPAPI_KEY for live prices."*

Add **`SERPAPI_KEY`** (from [serpapi.com](https://serpapi.com/), Google
Shopping engine) to switch to real, live prices — no code changes needed. The
app never scrapes retailer HTML directly; SerpApi is the primary live price
source, by design.

**Alternative live source — Gemini, no paid signup required.** If
`SERPAPI_KEY` isn't set but **`GEMINI_API_KEY`** is, the app uses Gemini
(via the official [`@google/genai`](https://www.npmjs.com/package/@google/genai)
SDK, a free key from [Google AI Studio](https://aistudio.google.com/apikey))
to find live prices instead. Priority order is SerpApi → Gemini → mock.
Gemini is a general-purpose model, not a shopping API, so this never trusts
it to invent a price or URL from its own knowledge: it uses Google Search
grounding to get real citation URLs, then a second structured-extraction
call constrained to only those URLs, and every resulting offer is filtered
through a **trusted-vendor allow-list** (`lib/trustedVendors.ts` —
Amazon, Walmart, Target, Best Buy, eBay, Costco, Newegg, Home Depot, Apple,
Samsung, B&H, Adorama) before it's shown — offers on unrecognized domains
are dropped, never displayed. Verified offers get a "Verified retailer"
badge in the UI. If nothing survives that filtering, or either Gemini call
fails or times out, it falls back to mock data like every other live
source.

If live search ever times out or errors, the app automatically falls back to
mock data with a visible on-page notice instead of showing a blank error page.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY at minimum
npm run dev
```

Open http://localhost:3000. With only `ANTHROPIC_API_KEY` set you'll see the
demo-mode banner and sample offers; add `SERPAPI_KEY` for live prices.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Powers `/api/identify` via the Anthropic SDK. Without it, text inputs (name/description) fall back to a simple heuristic normalizer, and image uploads return a clear error since identifying a photo requires vision. |
| `SERPAPI_KEY` | No | Enables live prices via SerpApi's Google Shopping engine. Omit it to run in demo mode with mock offers. |
| `GEMINI_API_KEY` | No | 2nd-choice live price source (Google Search-grounded, no paid signup) used only when `SERPAPI_KEY` is unset. Get a free key from [Google AI Studio](https://aistudio.google.com/apikey). Offer links are filtered through the trusted-vendor allow-list — see caveat above. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis REST credentials for a shared, durable ~15-minute cache of search results across serverless invocations. Omit both to use an in-memory cache instead (per-instance, cleared on cold start). |
| `NEXT_PUBLIC_APP_NAME` | No | Display name shown in the page title/header. Defaults to "PriceScout". |

See [`.env.example`](./.env.example) for the full list with comments.

## Architecture

```
app/
  page.tsx                 tabbed input UI + results orchestration (client)
  layout.tsx
  api/identify/route.ts    POST: image/name/description -> NormalizedQuery
  api/search-prices/route.ts  POST: NormalizedQuery -> Offer[]
components/                Tabs, input forms, results/best-price cards, banners
lib/
  anthropic.ts             Anthropic SDK wrapper + JSON response parsing
  currency.ts              FX conversion to USD (open.er-api.com, 1hr cache)
  cache.ts                 Upstash Redis client, in-memory LRU fallback
  ratelimit.ts             IP-based rate limiting for /api/*
  image.ts                 client-side image resize/compression before upload
  providers/
    types.ts               PriceProvider interface
    serpapi.ts              live provider (SerpApi Google Shopping)
    gemini.ts                 fallback live provider (Gemini + Google Search grounding)
    mock.ts                    deterministic demo-mode provider
    index.ts                   picks serpapi -> gemini -> mock by env vars
  trustedVendors.ts          retailer domain allow-list + isTrustedVendorUrl()
types/index.ts              shared request/response/data contracts
tests/unit/                 Vitest: providers, currency, query normalization
tests/e2e/                  Playwright: name-tab search -> results end to end
```

The price provider layer is the key abstraction: `lib/providers/index.ts`
returns a `SerpApiPriceProvider` when `SERPAPI_KEY` is set, else a
`GeminiPriceProvider` when `GEMINI_API_KEY` is set, else the
`MockPriceProvider` — every caller only depends on the shared
`PriceProvider` interface. This keeps the live-data path swappable (e.g. for
another licensed aggregator) without touching API routes or UI.

## Testing

```bash
npm run lint        # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npm run test:e2e     # Playwright end-to-end test (builds + runs the app, mock provider path)
npm run build         # production build
```

## Deploying to Vercel

1. Push this repository (or your fork) to GitHub.
2. In the [Vercel dashboard](https://vercel.com/new), import the repository.
   Vercel auto-detects Next.js — no build settings need to change.
3. Under **Project Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` (required)
   - `SERPAPI_KEY` (optional — omit to launch in demo mode, add later for live prices)
   - `GEMINI_API_KEY` (optional — free live-price fallback if `SERPAPI_KEY` isn't set; see caveat above)
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (optional)
   - `NEXT_PUBLIC_APP_NAME` (optional)
4. Deploy. The app is fully functional immediately with just
   `ANTHROPIC_API_KEY` set (demo-mode pricing); adding `SERPAPI_KEY` later and
   redeploying switches it to live prices with no code changes.

Alternatively, via the Vercel CLI from the project root:

```bash
npm i -g vercel
vercel link
vercel env add ANTHROPIC_API_KEY
vercel env add SERPAPI_KEY        # optional
vercel --prod
```

## Out of scope (this pass)

No user accounts/auth, no native mobile app, no retailer HTML scraping — live
prices come only from SerpApi's licensed API or Gemini's Google Search
grounding tool (real citations, filtered to the trusted-vendor allow-list).
