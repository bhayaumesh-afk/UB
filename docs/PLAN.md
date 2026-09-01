# PriceScout — Best Price Finder

## What it does

User provides a **product image**, a **product name**, or a **free-text description**. The app
identifies the product and returns the **best available price in USD** across online stores,
sorted low-to-high, with a direct "buy" link.

## User flow

1. User picks one of three input tabs: Image / Name / Description.
2. Frontend sends the input to `POST /api/identify`.
   - Image or description → Gemini on Vertex AI (same `GCP_SERVICE_ACCOUNT_JSON` credential
     used for pricing, `gemini-2.5-flash`, single call with a JSON response schema — no
     search grounding involved here, so none of the two-call/citation machinery pricing
     needs applies) extracts a normalized product query:
     `{ title, brand?, category?, confidence, candidates?[] }`. Gemini fully replaces
     Claude/Anthropic for identification — there is no `ANTHROPIC_API_KEY` in this app.
   - Name → light normalization pass (typo/brand cleanup) through the same endpoint, with a
     zero-AI heuristic fallback if the Gemini call fails or the credential is unset.
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
- **2nd choice: Gemini (Vertex AI) + Google Search grounding, via service-account auth.**
  Used when `SERPAPI_KEY` is unset but `GCP_SERVICE_ACCOUNT_JSON` is set. This project
  already has a working, tested service-account credential for Vertex AI (proven via a
  manual OAuth2 token-exchange test that successfully called `gemini-2.5-flash`) — auth
  uses that service account, not a `GEMINI_API_KEY`/Developer-API key.
  - Auth: `google-auth-library`'s `JWT` class, constructed from the parsed JSON's
    `client_email`/`private_key` fields, scope `https://www.googleapis.com/auth/cloud-platform`,
    token obtained via `client.getAccessToken()`.
  - Endpoint: called directly via `fetch` against the Vertex AI REST endpoint
    (`https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-2.5-flash:generateContent`),
    with `Authorization: Bearer <token>` — not the `@google/genai` SDK's Vertex wrapper,
    since its exact option for in-memory (non-file) credentials isn't reliably documented.
    `project` comes from the JSON's own `project_id` field; `location` comes from
    `GCP_VERTEX_LOCATION`, reusing whatever region already worked in this project's earlier
    auth test — do not guess a different region.
  - Gemini is a general-purpose model, not a shopping API, so this relies specifically on
    its **Google Search grounding tool**, which returns real, live search-result citations
    rather than the model's own text. Implementation is a **two-call pattern**, because
    Gemini does not reliably support combining tool use (grounding) with strict JSON
    response-schema output in a single call (confirmed broken/empty grounding metadata when
    combined, per Google's own developer forum):
    1. Call `gemini-2.5-flash` with `tools: [{ google_search: {} }]` and a prompt asking it
       to find current USD prices for the normalized product query at named reputable
       retailers. Read `groundingMetadata.groundingChunks[].web.uri` — **this is a Google/
       Vertex redirect URL, not the retailer's real URL** — and `.title` (a domain-like
       label). Resolve each chunk's real destination by following the redirect server-side
       (HEAD/GET, short timeout) and use the *final* URL, never the raw grounding URI, as
       the offer link. Never trust a URL the model prints in prose — only resolved,
       allow-listed grounding-chunk URLs.
    2. Call the model again, no tools, `responseMimeType: "application/json"` with a
       response schema, passing call 1's answer text plus a *numbered list* of the already
       trusted, resolved chunks (index + domain only, no URLs) — the model returns an index,
       never a URL string, so it structurally cannot fabricate a link.
    3. Also surface `groundingMetadata.searchEntryPoint.renderedContent` in the results UI —
       Google's grounding terms require displaying this attribution widget when grounded
       results are shown to users.
  - Post-process every offer through `isTrustedVendorUrl()` (see Trusted vendors below) and
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
SERPAPI_KEY=                    # optional — 1st choice for live prices if set
GCP_SERVICE_ACCOUNT_JSON=       # powers identification (image/name/description, replacing
                                 # Claude entirely) AND is the 2nd-choice live price source
                                 # (Vertex AI Gemini w/ Google Search grounding) if
                                 # SERPAPI_KEY is unset. Full service-account key JSON as
                                 # one line (minify with `jq -c .` before pasting).
GCP_VERTEX_LOCATION=             # required alongside GCP_SERVICE_ACCOUNT_JSON — reuse the
                                 # region already proven working in this project's auth test
UPSTASH_REDIS_REST_URL=         # optional — in-memory cache used if unset
UPSTASH_REDIS_REST_TOKEN=       # optional
NEXT_PUBLIC_APP_NAME=PriceScout
```

There is no `ANTHROPIC_API_KEY` in this app — Gemini/Vertex AI (via
`GCP_SERVICE_ACCOUNT_JSON`) is the sole AI provider, for both identification and pricing.

`GCP_SERVICE_ACCOUNT_JSON` is a broader credential than a plain API key (it's scoped by
whatever IAM roles are bound to that service account) — treat it with at least the same
care as a private key: never commit it, never log it, and confirm in the GCP console that
the service account only holds the roles it actually needs (e.g. `roles/aiplatform.user`),
not a broad/owner role.

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
Input UI (3 tabs), `/api/identify` (originally Claude, since replaced — see Phase 2), mock
price provider, results UI with best-price highlight, demo-mode banner.

**Phase 2 — Live pricing + Gemini identification (done, live-verified)**
SerpApi provider, currency conversion, caching, empty/error states, rate limiting, the
Gemini-grounded pricing provider, the trusted-vendor allow-list, and Gemini/Vertex AI
identification (replacing Claude entirely — no `ANTHROPIC_API_KEY` in this app) are all
built and merged. This was verified against the real service-account credential, not just
unit tests, which surfaced and fixed two real bugs:
- The grounded search call's timeout had no real margin against actual Gemini latency
  (12-20s typical, observed spikes past that) and was intermittently, silently falling back
  to mock data while reporting success. Fixed: widened to 45s based on live measurement
  across several fresh queries.
- A low-confidence identify result with no candidates (e.g. a genuinely unidentifiable
  photo) could reach the price-search call unguarded — sometimes a 400, sometimes a
  meaningless live search that silently degraded to mock. Fixed: the confidence gate now
  always resolves to either the candidate picker or a clear "could not identify" message.

Confirmed live and working: Name, Description, and Photo tabs all produce real Gemini
results with correct currency handling, trusted-retailer links, and the required Google
Search attribution widget. Production deployment (Vercel) remains intentionally deferred —
not in scope right now; verification is local-preview only.

**Known limitations to revisit, not blockers:**
- **Latency**: live search typically takes 30-47s end to end (grounded search is
  inherently slow — Google executes a real search before responding). There's a loading
  message during this wait; a progress indicator or partial-results streaming would be a
  worthwhile future polish, not a correctness issue.
- **Loose text-based matching**: a vague description can identify the wrong specific model
  (e.g. a prior generation) and surface implausible outlier prices from a loosely-matched
  listing. A price-plausibility filter (e.g. dropping offers far below the median for a
  query) is a reasonable future improvement; not attempted yet.
- **Deployment readiness**: if/when Vercel deployment resumes, the serverless function
  duration limit will need to be raised to accommodate the ~45s worst case (see
  `maxDuration` route segment config) — see the code comment in `lib/providers/gemini.ts`.

**Phase 3 — Stretch**
Price-history sparkline (needs a lightweight store, e.g. Supabase, for daily snapshots),
email price-drop alerts, affiliate link tagging, richer multi-candidate disambiguation,
mobile polish, basic analytics, price-plausibility filtering (pulled up from Phase 2 known
limitations above).

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

Deferred — not currently in scope. The app is verified via local preview
(`npm run dev` + a headless-browser screenshot pass across all three input tabs) rather than
a production deploy. When deployment resumes, `docs/PLAN.md` should be updated with the
target platform and required env vars at that time (see `.env.example` for what's currently
needed to run it locally).
