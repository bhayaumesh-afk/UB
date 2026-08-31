import { describe, expect, it } from "vitest";
import { normalizeHeuristically, toNormalizedQuery } from "@/lib/identify";

describe("toNormalizedQuery", () => {
  it("maps required fields and defaults confidence when valid", () => {
    const result = toNormalizedQuery({ query: "Sony WH-1000XM5", title: "Sony WH-1000XM5" });
    expect(result).toEqual({
      query: "Sony WH-1000XM5",
      title: "Sony WH-1000XM5",
      brand: undefined,
      category: undefined,
      confidence: 0.5,
      candidates: undefined,
    });
  });

  it("passes through brand, category, and confidence when present", () => {
    const result = toNormalizedQuery({
      query: "Sony WH-1000XM5",
      title: "Sony WH-1000XM5 Headphones",
      brand: "Sony",
      category: "Electronics",
      confidence: 0.95,
    });
    expect(result.brand).toBe("Sony");
    expect(result.category).toBe("Electronics");
    expect(result.confidence).toBe(0.95);
  });

  it("clamps out-of-range confidence values back to the default", () => {
    const result = toNormalizedQuery({ query: "x", title: "x", confidence: 5 });
    expect(result.confidence).toBe(0.5);
  });

  it("caps candidates at 3 and drops empty titles", () => {
    const result = toNormalizedQuery({
      query: "x",
      title: "x",
      confidence: 0.3,
      candidates: [{ title: "A" }, { title: "B" }, { title: "" }, { title: "C" }, { title: "D" }],
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates?.map((c) => c.title)).toEqual(["A", "B", "C"]);
  });

  it("throws when required fields are missing", () => {
    expect(() => toNormalizedQuery({ title: "x" })).toThrow();
    expect(() => toNormalizedQuery(null)).toThrow();
    expect(() => toNormalizedQuery("not an object")).toThrow();
  });
});

describe("normalizeHeuristically", () => {
  it("builds a query/title from a product name", () => {
    const result = normalizeHeuristically({ mode: "name", name: "  Sony WH-1000XM5  " });
    expect(result).toEqual({ query: "Sony WH-1000XM5", title: "Sony WH-1000XM5", confidence: 0.9 });
  });

  it("builds a query/title from a description", () => {
    const result = normalizeHeuristically({ mode: "description", description: "black noise cancelling headphones" });
    expect(result.query).toBe("black noise cancelling headphones");
    expect(result.confidence).toBe(0.9);
  });

  it("throws when there is no usable text", () => {
    expect(() => normalizeHeuristically({ mode: "name", name: "" })).toThrow();
    expect(() => normalizeHeuristically({ mode: "image" })).toThrow();
  });
});
