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

**Alternative live source — Gemini on Vertex AI, no paid SerpApi signup
required.** If `SERPAPI_KEY` isn't set but `GCP_SERVICE_ACCOUNT_JSON` is,
the app uses Gemini (`gemini-2.5-flash` on Vertex AI, called directly via
`fetch` against the REST `generateContent` endpoint — no SDK) to find live
prices instead. Priority order is SerpApi → Gemini → mock. Authentication
uses a [`google-auth-library`](https://www.npmjs.com/package/google-auth-library)
`JWT` client built directly from the service account's email/private key
(see `lib/providers/vertexAuth.ts`) — no `gcloud` CLI or Application
Default Credentials file needed, so this works in a stateless serverless
deployment.

Gemini is a general-purpose model, not a shopping API, so this never trusts
it to invent a price or URL from its own knowledge — it works only through
grounded, verifiable citations, via a three-step pipeline:
1. **Grounded search** (Google Search tool) returns an answer plus citation
   chunks. Each chunk's URL is a Google/Vertex *redirect* link
   (`vertexaisearch.cloud.google.com/...`), never the retailer's real URL.
2. **Resolve** — each chunk whose title loosely matches a trusted domain has
   its redirect followed server-side (HEAD, GET fallback) to get the actual
   final URL, which is then checked against a **trusted-vendor allow-list**
   (`lib/trustedVendors.ts` — Amazon, Walmart, Target, Best Buy, eBay,
   Costco, Newegg, Home Depot, Apple, Samsung, B&H, Adorama). Only resolved,
   trusted URLs survive.
3. **Structured extraction** — a second call is given the answer text plus a
   numbered list of the *resolved* retailers (index + domain label, no
   URLs) and asked to reference a `storeIndex` per offer. The model never
   outputs a URL or store name itself, so it structurally cannot introduce
   an untrusted link — the app maps each index back to the URL it already
   verified in step 2.

Verified offers get a "Verified retailer" badge in the UI. Whenever this
provider serves a response, the page also renders Google's required
[Search grounding attribution widget](https://ai.google.dev/gemini-api/docs/grounding)
(`SearchAttribution` component) — a condition of using grounded results, not
decorative. If nothing survives the trust filtering, or either Vertex call
fails or times out (~15s each), it falls back to mock data like every other
live source.

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
| `GCP_SERVICE_ACCOUNT_JSON` | No | 2nd-choice live price source (Gemini on Vertex AI, Google Search-grounded), used only when `SERPAPI_KEY` is unset. Paste the full downloaded service-account JSON as a single-line string (minify with `jq -c .` first so the private key's embedded newlines don't break env var storage). The service account only needs the `roles/aiplatform.user` role — least privilege. Offer links are resolved and filtered through the trusted-vendor allow-list — see caveat above. Vertex AI Search grounding is billed per grounded request; the app's existing ~15-minute cache limits repeat cost for the same query. |
| `GCP_VERTEX_LOCATION` | No | Vertex AI region to call. Defaults to `us-central1` — reuse whatever region has already been proven to work for your project rather than guessing a different one, since an unproven region can silently 404 or route to a disabled model. |
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
    gemini.ts                 fallback live provider (Vertex AI Gemini + Google Search grounding, raw REST)
    vertexAuth.ts               JWT service-account auth for the Vertex AI REST calls
    mock.ts                      deterministic demo-mode provider
    index.ts                      picks serpapi -> gemini -> mock by env vars
  trustedVendors.ts          retailer domain allow-list + isTrustedVendorUrl()
types/index.ts              shared request/response/data contracts
tests/unit/                 Vitest: providers, currency, query normalization
tests/e2e/                  Playwright: name-tab search -> results end to end
```

The price provider layer is the key abstraction: `lib/providers/index.ts`
returns a `SerpApiPriceProvider` when `SERPAPI_KEY` is set, else a
`GeminiPriceProvider` when `GCP_SERVICE_ACCOUNT_JSON` is set, else the
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
   - `GCP_SERVICE_ACCOUNT_JSON` / `GCP_VERTEX_LOCATION` (optional — live-price fallback if `SERPAPI_KEY` isn't set; see caveat above)
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
