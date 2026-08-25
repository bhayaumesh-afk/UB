import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mapExtractedOffers, resolveGroundedChunks, GeminiPriceProvider, type ResolvedChunk } from "@/lib/providers/gemini";

describe("mapExtractedOffers", () => {
  const resolved: ResolvedChunk[] = [
    { index: 0, url: "https://www.amazon.com/dp/1", domainLabel: "amazon.com" },
    { index: 1, url: "https://www.walmart.com/ip/2", domainLabel: "walmart.com" },
  ];

  it("maps a valid storeIndex back to the resolved chunk's real URL", () => {
    const result = mapExtractedOffers(JSON.stringify([{ storeIndex: 0, price: 99.99, currency: "USD" }]), resolved);
    expect(result).toEqual([{ store: "amazon.com", price: 99.99, url: "https://www.amazon.com/dp/1", currency: "USD" }]);
  });

  it("drops an entry whose storeIndex is out of range — the model can never invent a URL this way", () => {
    const result = mapExtractedOffers(JSON.stringify([{ storeIndex: 5, price: 10, currency: "USD" }]), resolved);
    expect(result).toEqual([]);
  });

  it("drops entries with a non-integer or missing storeIndex", () => {
    const result = mapExtractedOffers(
      JSON.stringify([{ storeIndex: 0.5, price: 10, currency: "USD" }, { price: 10, currency: "USD" }]),
      resolved
    );
    expect(result).toEqual([]);
  });

  it("drops entries with missing or invalid price", () => {
    const result = mapExtractedOffers(
      JSON.stringify([
        { storeIndex: 0, currency: "USD" },
        { storeIndex: 0, price: -5, currency: "USD" },
      ]),
      resolved
    );
    expect(result).toEqual([]);
  });

  it("defaults currency to USD and uppercases a supplied currency", () => {
    const result = mapExtractedOffers(
      JSON.stringify([
        { storeIndex: 0, price: 90 },
        { storeIndex: 1, price: 90, currency: " eur " },
      ]),
      resolved
    );
    expect(result[0].currency).toBe("USD");
    expect(result[1].currency).toBe("EUR");
  });

  it("carries through optional shipping and rating when present and valid", () => {
    const result = mapExtractedOffers(
      JSON.stringify([{ storeIndex: 0, price: 90, currency: "USD", shipping: "Free Prime shipping", rating: 4.6 }]),
      resolved
    );
    expect(result[0].shipping).toBe("Free Prime shipping");
    expect(result[0].rating).toBe(4.6);
  });

  it("throws on malformed JSON", () => {
    expect(() => mapExtractedOffers("not json", resolved)).toThrow();
  });

  it("throws when the response is not a JSON array", () => {
    expect(() => mapExtractedOffers(JSON.stringify({ storeIndex: 0 }), resolved)).toThrow();
  });
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, url: "", json: async () => body, body: { cancel: async () => {} } } as unknown as Response;
}

function redirectResponse(finalUrl: string): Response {
  return { ok: true, status: 200, url: finalUrl, json: async () => ({}), body: { cancel: async () => {} } } as unknown as Response;
}

describe("resolveGroundedChunks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pre-filters chunks whose title doesn't loosely match a trusted domain, without ever fetching them", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should never be called for a pre-filtered chunk");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGroundedChunks([{ web: { uri: "https://redirect.example/x", title: "sketchy-deals.example" } }]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a trusted-titled chunk through its redirect to a trusted final URL", async () => {
    const fetchMock = vi.fn(async () => redirectResponse("https://www.amazon.com/dp/1"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGroundedChunks([{ web: { uri: "https://redirect.example/abc1", title: "amazon.com" } }]);
    expect(result).toEqual([{ index: 0, url: "https://www.amazon.com/dp/1", domainLabel: "amazon.com" }]);
  });

  it("drops a chunk whose title loosely matched but final resolved URL is an untrusted look-alike domain", async () => {
    const fetchMock = vi.fn(async () => redirectResponse("https://amazon.com.evil.tld/x"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGroundedChunks([{ web: { uri: "https://redirect.example/abc4", title: "amazon.com" } }]);
    expect(result).toEqual([]);
  });

  it("drops a chunk whose redirect resolution throws (network error/timeout)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network error");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGroundedChunks([{ web: { uri: "https://redirect.example/abc5", title: "walmart.com" } }]);
    expect(result).toEqual([]);
  });

  it("assigns stable sequential indices only to chunks that survive filtering, in order", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("abc1")) return redirectResponse("https://www.amazon.com/dp/1");
      if (url.includes("abc2")) return redirectResponse("https://www.walmart.com/ip/2");
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveGroundedChunks([
      { web: { uri: "https://redirect.example/abc1", title: "amazon.com" } },
      { web: { uri: "https://redirect.example/xyz", title: "sketchy-deals.example" } }, // pre-filtered
      { web: { uri: "https://redirect.example/abc2", title: "walmart.com" } },
    ]);
    expect(result).toEqual([
      { index: 0, url: "https://www.amazon.com/dp/1", domainLabel: "amazon.com" },
      { index: 1, url: "https://www.walmart.com/ip/2", domainLabel: "walmart.com" },
    ]);
  });
});

vi.mock("@/lib/providers/vertexAuth", () => ({
  getAccessToken: vi.fn(async () => "fake-access-token"),
  getGcpProjectId: vi.fn(() => "fake-project"),
}));

const call1Fixture = {
  candidates: [
    {
      content: { parts: [{ text: "Amazon has it for $99.99 and Walmart has it for $89.99." }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc1", title: "amazon.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc2", title: "walmart.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc3", title: "sketchy-deals.example" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc4", title: "amazon.com" } },
        ],
        searchEntryPoint: { renderedContent: '<div class="container">attribution widget</div>' },
      },
    },
  ],
};

const call2Fixture = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify([
              { storeIndex: 0, price: 99.99, currency: "USD" },
              { storeIndex: 1, price: 89.99, currency: "USD" },
              { storeIndex: 5, price: 1, currency: "USD" }, // out of range — must be dropped
            ]),
          },
        ],
      },
    },
  ],
};

const redirectMap: Record<string, string> = {
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc1": "https://www.amazon.com/dp/1",
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc2": "https://www.walmart.com/ip/2",
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc4": "https://amazon.com.evil.tld/x",
};

function makeFetchMock() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes(":generateContent")) {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      if (bodyStr.includes('"tools"')) return jsonResponse(call1Fixture);
      if (bodyStr.includes("generationConfig")) return jsonResponse(call2Fixture);
      throw new Error("Unexpected generateContent call shape in test mock");
    }
    const finalUrl = redirectMap[url];
    if (!finalUrl) {
      throw new Error(`Unexpected fetch to a URL that should have been pre-filtered: ${url}`);
    }
    return redirectResponse(finalUrl);
  });
}

describe("GeminiPriceProvider.search (mocked fetch + vertexAuth)", () => {
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns only offers whose URL was actually resolved and trusted, sorted ascending", async () => {
    const provider = new GeminiPriceProvider("us-central1");
    const offers = await provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 });

    expect(offers.map((o) => o.url)).toEqual(["https://www.walmart.com/ip/2", "https://www.amazon.com/dp/1"]);
    for (const o of offers) {
      expect(o.url).not.toContain("vertexaisearch.cloud.google.com");
      expect(o.url).not.toContain("evil.tld");
    }
  });

  it("captures the grounding attribution widget from call 1", async () => {
    const provider = new GeminiPriceProvider("us-central1");
    await provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 });
    expect(provider.lastAttributionHtml).toContain("attribution widget");
  });

  it("never fetches the pre-filtered (untrusted-titled) grounding chunk", async () => {
    const provider = new GeminiPriceProvider("us-central1");
    await provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 });
    const fetchedUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).not.toContain("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc3");
  });

  it("throws (so the caller falls back to mock) when no grounding chunks come back", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes(":generateContent")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes('"tools"')) {
          return jsonResponse({ candidates: [{ content: { parts: [{ text: "No results." }] }, groundingMetadata: {} }] });
        }
      }
      throw new Error("unexpected call");
    });

    const provider = new GeminiPriceProvider("us-central1");
    await expect(
      provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 })
    ).rejects.toThrow();
  });

  it("throws when every grounded chunk fails to resolve to a trusted URL", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes(":generateContent")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes('"tools"')) {
          return jsonResponse({
            candidates: [
              {
                content: { parts: [{ text: "Only found it at an unrecognized site." }] },
                groundingMetadata: {
                  groundingChunks: [{ web: { uri: "https://redirect.example/x", title: "sketchy-deals.example" } }],
                },
              },
            ],
          });
        }
      }
      throw new Error("unexpected call");
    });

    const provider = new GeminiPriceProvider("us-central1");
    await expect(
      provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 })
    ).rejects.toThrow();
  });
});
