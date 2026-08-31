import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { identifyProduct } from "@/lib/identify";

vi.mock("@/lib/providers/vertexAuth", () => ({
  getAccessToken: vi.fn(async () => "fake-access-token"),
  getGcpProjectId: vi.fn(() => "fake-project"),
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function generateContentFixture(resultObj: unknown): unknown {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(resultObj) }] } }] };
}

describe("identifyProduct (mocked fetch + vertexAuth)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("identifies a product from a name and returns the parsed NormalizedQuery", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        generateContentFixture({
          query: "Sony WH-1000XM5 wireless headphones",
          title: "Sony WH-1000XM5",
          brand: "Sony",
          category: "Electronics",
          confidence: 0.95,
        })
      )
    );

    const result = await identifyProduct({ mode: "name", name: "Sony WH-1000XM5" });
    expect(result).toEqual({
      query: "Sony WH-1000XM5 wireless headphones",
      title: "Sony WH-1000XM5",
      brand: "Sony",
      category: "Electronics",
      confidence: 0.95,
      candidates: undefined,
    });
  });

  it("sends the image as inlineData and a text part for image mode", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(generateContentFixture({ query: "a mug", title: "Coffee mug", confidence: 0.7 }))
    );

    await identifyProduct({ mode: "image", imageBase64: "ZmFrZQ==", imageMediaType: "image/jpeg" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "ZmFrZQ==" } });
    expect(typeof parts[1].text).toBe("string");
  });

  it("requests a JSON response schema (no grounding tool) for identify calls", async () => {
    fetchMock.mockResolvedValue(jsonResponse(generateContentFixture({ query: "x", title: "x", confidence: 0.5 })));
    await identifyProduct({ mode: "name", name: "x" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.tools).toBeUndefined();
  });

  it("throws when imageBase64/imageMediaType are missing for image mode", async () => {
    await expect(identifyProduct({ mode: "image" })).rejects.toThrow(/imageBase64/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when name is missing for name mode", async () => {
    await expect(identifyProduct({ mode: "name" })).rejects.toThrow(/name is required/);
  });

  it("throws when description is missing for description mode", async () => {
    await expect(identifyProduct({ mode: "description" })).rejects.toThrow(/description is required/);
  });

  it("throws for an unsupported mode", async () => {
    // @ts-expect-error deliberately invalid mode for the error-path test
    await expect(identifyProduct({ mode: "bogus" })).rejects.toThrow(/Unsupported mode/);
  });

  it("throws when the model response isn't valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
    });
    await expect(identifyProduct({ mode: "name", name: "x" })).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the model response has no text content", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{}] }) });
    await expect(identifyProduct({ mode: "name", name: "x" })).rejects.toThrow(/no text content/);
  });

  it("propagates an HTTP error from the Vertex AI call", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(identifyProduct({ mode: "name", name: "x" })).rejects.toThrow(/HTTP 500/);
  });
});
