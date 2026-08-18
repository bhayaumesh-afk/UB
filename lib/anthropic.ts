import Anthropic from "@anthropic-ai/sdk";
import type { IdentifyRequestBody, NormalizedQuery } from "@/types";

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a product identification assistant for a price-comparison app.
Given an image, a product name, or a free-text description, identify the specific
product the user means and produce a normalized shopping search query.

Respond with ONLY a JSON object (no markdown fences, no prose) matching this shape:
{
  "query": string,        // concise search-engine-ready query, e.g. "Sony WH-1000XM5 wireless headphones black"
  "title": string,        // human-readable product title
  "brand": string | null,
  "category": string | null,
  "confidence": number,   // 0..1, how confident you are this is the exact product
  "candidates": [         // OPTIONAL, only include when confidence < 0.6, up to 3 entries
    { "title": string, "brand": string | null, "category": string | null }
  ]
}`;

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  return JSON.parse(jsonText);
}

export function toNormalizedQuery(raw: unknown): NormalizedQuery {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Model response was not a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.query !== "string" || typeof obj.title !== "string") {
    throw new Error("Model response missing required fields");
  }
  const confidence =
    typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
      ? obj.confidence
      : 0.5;

  const candidatesRaw = Array.isArray(obj.candidates) ? obj.candidates : undefined;
  const candidates = candidatesRaw
    ?.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      title: String(c.title ?? ""),
      brand: typeof c.brand === "string" ? c.brand : undefined,
      category: typeof c.category === "string" ? c.category : undefined,
    }))
    .filter((c) => c.title.length > 0)
    .slice(0, 3);

  return {
    query: obj.query,
    title: obj.title,
    brand: typeof obj.brand === "string" ? obj.brand : undefined,
    category: typeof obj.category === "string" ? obj.category : undefined,
    confidence,
    candidates: candidates && candidates.length > 0 ? candidates : undefined,
  };
}

/**
 * Heuristic fallback used for text-based inputs (name/description) when the
 * Anthropic API is unavailable or unconfigured, so the app degrades gracefully
 * instead of hard-failing. Not usable for image mode, which requires vision.
 */
export function normalizeHeuristically(input: IdentifyRequestBody): NormalizedQuery {
  const text = (input.mode === "name" ? input.name : input.description)?.trim();
  if (!text) {
    throw new Error("No text available for heuristic normalization");
  }
  return { query: text, title: text, confidence: 0.9 };
}

/**
 * Calls Claude (vision-capable) to turn a raw product input (image / name /
 * free-text description) into a NormalizedQuery for the price search step.
 */
export async function identifyProduct(input: IdentifyRequestBody): Promise<NormalizedQuery> {
  const anthropic = getClient();

  const content: Anthropic.MessageParam["content"] = [];

  if (input.mode === "image") {
    if (!input.imageBase64 || !input.imageMediaType) {
      throw new Error("imageBase64 and imageMediaType are required for mode 'image'");
    }
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: input.imageMediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: input.imageBase64,
      },
    });
    content.push({
      type: "text",
      text: "Identify the product in this image and respond with the JSON object described in your instructions.",
    });
  } else if (input.mode === "name") {
    if (!input.name) {
      throw new Error("name is required for mode 'name'");
    }
    content.push({
      type: "text",
      text: `Product name: "${input.name}"\n\nNormalize this into the JSON object described in your instructions.`,
    });
  } else if (input.mode === "description") {
    if (!input.description) {
      throw new Error("description is required for mode 'description'");
    }
    content.push({
      type: "text",
      text: `Product description: "${input.description}"\n\nIdentify the product and respond with the JSON object described in your instructions.`,
    });
  } else {
    throw new Error(`Unsupported mode: ${input.mode}`);
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model response had no text content");
  }

  const parsed = extractJson(textBlock.text);
  return toNormalizedQuery(parsed);
}
