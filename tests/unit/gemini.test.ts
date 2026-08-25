import { describe, expect, it, vi } from "vitest";
import { filterGroundedOffers, GeminiPriceProvider } from "@/lib/providers/gemini";

describe("filterGroundedOffers", () => {
  const groundedUrls = ["https://www.amazon.com/dp/1", "https://www.walmart.com/ip/2", "https://sketchy-deals.example/x"];

  it("keeps an offer whose URL is both grounded and trusted", () => {
    const result = filterGroundedOffers(
      [{ store: "Amazon", price: 99.99, url: "https://www.amazon.com/dp/1" }],
      groundedUrls
    );
    expect(result).toEqual([{ store: "Amazon", price: 99.99, url: "https://www.amazon.com/dp/1", currency: "USD" }]);
  });

  it("drops an offer whose URL is grounded but not on the trusted-vendor allow-list", () => {
    const result = filterGroundedOffers(
      [{ store: "Sketchy Deals", price: 10, url: "https://sketchy-deals.example/x" }],
      groundedUrls
    );
    expect(result).toEqual([]);
  });

  it("drops an offer whose URL is on a trusted domain but was never grounded (invented by the model)", () => {
    const result = filterGroundedOffers(
      [{ store: "Invented", price: 5, url: "https://www.amazon.com/dp/not-in-grounding-chunks" }],
      groundedUrls
    );
    expect(result).toEqual([]);
  });

  it("drops offers with missing or invalid required fields", () => {
    const result = filterGroundedOffers(
      [
        { store: "Missing price", url: "https://www.amazon.com/dp/1" },
        { store: "Bad price", price: -5, url: "https://www.amazon.com/dp/1" },
        { price: 10, url: "https://www.amazon.com/dp/1" },
        { store: "No url", price: 10 },
      ],
      groundedUrls
    );
    expect(result).toEqual([]);
  });

  it("returns an empty array when raw offers is not an array", () => {
    expect(filterGroundedOffers({ store: "x" }, groundedUrls)).toEqual([]);
    expect(filterGroundedOffers(null, groundedUrls)).toEqual([]);
  });

  it("uppercases and trims a supplied originalCurrency, defaulting to USD", () => {
    const result = filterGroundedOffers(
      [
        { store: "Amazon", price: 90, url: "https://www.amazon.com/dp/1", originalCurrency: " eur " },
        { store: "Walmart", price: 90, url: "https://www.walmart.com/ip/2" },
      ],
      groundedUrls
    );
    expect(result[0].currency).toBe("EUR");
    expect(result[1].currency).toBe("USD");
  });

  it("carries through optional shipping and rating when present and valid", () => {
    const result = filterGroundedOffers(
      [{ store: "Amazon", price: 90, url: "https://www.amazon.com/dp/1", shipping: "Free Prime shipping", rating: 4.6 }],
      groundedUrls
    );
    expect(result[0].shipping).toBe("Free Prime shipping");
    expect(result[0].rating).toBe(4.6);
  });
});

// Mock the SDK: models.generateContent inspects the request config to decide which
// canned fixture to return, so this works regardless of call order.
const groundingFixture = {
  text: "Amazon has it for $99.99, Walmart has it for $89.99, and Sketchy Deals has it for $10.",
  candidates: [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://www.amazon.com/dp/1" } },
          { web: { uri: "https://www.walmart.com/ip/2" } },
          { web: { uri: "https://sketchy-deals.example/x" } },
        ],
      },
    },
  ],
};

const extractionFixture = {
  text: JSON.stringify([
    { store: "Amazon", price: 99.99, url: "https://www.amazon.com/dp/1" },
    { store: "Walmart", price: 89.99, url: "https://www.walmart.com/ip/2" },
    // Untrusted domain, even though it was a real grounded citation.
    { store: "Sketchy Deals", price: 10, url: "https://sketchy-deals.example/x" },
    // Trusted domain, but this exact URL was never in the grounding chunks.
    { store: "Invented", price: 5, url: "https://www.amazon.com/dp/invented-not-grounded" },
  ]),
};

const generateContentMock = vi.fn(async (req: { config?: { tools?: unknown; responseMimeType?: string } }) => {
  if (req.config?.tools) return groundingFixture;
  if (req.config?.responseMimeType === "application/json") return extractionFixture;
  throw new Error("Unexpected generateContent call shape in test mock");
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
  Type: { ARRAY: "ARRAY", OBJECT: "OBJECT", STRING: "STRING", NUMBER: "NUMBER" },
}));

describe("GeminiPriceProvider.search (mocked SDK)", () => {
  it("returns only offers that are both grounded and trusted, sorted ascending", async () => {
    const provider = new GeminiPriceProvider("fake-key");
    const offers = await provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 });

    expect(offers.map((o) => o.store)).toEqual(["Walmart", "Amazon"]);
    expect(offers.map((o) => o.url)).toEqual(["https://www.walmart.com/ip/2", "https://www.amazon.com/dp/1"]);

    const groundedUrlSet = new Set(groundingFixture.candidates[0].groundingMetadata.groundingChunks.map((c) => c.web.uri));
    for (const offer of offers) {
      expect(groundedUrlSet.has(offer.url)).toBe(true);
    }
  });

  it("throws (so the caller can fall back to mock) when nothing survives filtering", async () => {
    // Two calls happen in order: grounded search, then structured extraction.
    generateContentMock.mockImplementationOnce(async () => ({
      text: "Only found it at an unrecognized site.",
      candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://sketchy-deals.example/x" } }] } }],
    }));
    generateContentMock.mockImplementationOnce(async () => ({
      text: JSON.stringify([{ store: "Sketchy Deals", price: 10, url: "https://sketchy-deals.example/x" }]),
    }));

    const provider = new GeminiPriceProvider("fake-key");
    await expect(
      provider.search({ query: "wireless headphones", title: "wireless headphones", confidence: 1 })
    ).rejects.toThrow();
  });
});
