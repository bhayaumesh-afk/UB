import type { IdentifyRequestBody, NormalizedQuery } from "@/types";
import { getAccessToken, getGcpProjectId } from "@/lib/providers/vertexAuth";
import { callVertexGenerateContent, extractText } from "@/lib/providers/vertexRest";

// Product identification (image / name / description -> NormalizedQuery) via Gemini
// on Vertex AI, using the same service-account credential and raw-REST call pattern
// as the price provider (see lib/providers/gemini.ts, lib/providers/vertexAuth.ts).
// Unlike price search, this doesn't need Google Search grounding — it's just asking
// the model to understand content the user already provided — so it's a single call
// with a JSON response schema, no tools.

const MODEL = "gemini-2.5-flash";
const CALL_TIMEOUT_MS = 15000;
const DEFAULT_LOCATION = "us-central1";

function getLocation(): string {
  const location = process.env.GCP_VERTEX_LOCATION;
  return location && location.trim().length > 0 ? location : DEFAULT_LOCATION;
}

const INSTRUCTIONS = `You are a product identification assistant for a price-comparison app.
Given an image, a product name, or a free-text description, identify the specific
product the user means and produce a normalized shopping search query.

Respond with the fields:
- query: concise search-engine-ready query, e.g. "Sony WH-1000XM5 wireless headphones black"
- title: human-readable product title
- brand: the brand name, if identifiable
- category: the product category, if identifiable
- confidence: 0..1, how confident you are this is the exact product
- candidates: OPTIONAL, only include when confidence is below 0.6, up to 3 alternate {title, brand, category} guesses`;

const IDENTIFY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    query: { type: "STRING" },
    title: { type: "STRING" },
    brand: { type: "STRING" },
    category: { type: "STRING" },
    confidence: { type: "NUMBER" },
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          brand: { type: "STRING" },
          category: { type: "STRING" },
        },
        required: ["title"],
      },
    },
  },
  required: ["query", "title", "confidence"],
};

/**
 * Validates and normalizes the model's raw parsed JSON into a NormalizedQuery. Exported
 * for unit testing — never trust model output blindly, even with a response schema.
 */
export function toNormalizedQuery(raw: unknown): NormalizedQuery {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Model response was not a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.query !== "string" || typeof obj.title !== "string") {
    throw new Error("Model response missing required fields");
  }
  const confidence =
    typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1 ? obj.confidence : 0.5;

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
 * Heuristic fallback used for text-based inputs (name/description) when Gemini is
 * unavailable or unconfigured, so the app degrades gracefully instead of hard-failing.
 * Not usable for image mode, which requires vision.
 */
export function normalizeHeuristically(input: IdentifyRequestBody): NormalizedQuery {
  const text = (input.mode === "name" ? input.name : input.description)?.trim();
  if (!text) {
    throw new Error("No text available for heuristic normalization");
  }
  return { query: text, title: text, confidence: 0.9 };
}

/**
 * Calls Gemini (vision-capable) on Vertex AI to turn a raw product input (image /
 * name / free-text description) into a NormalizedQuery for the price search step.
 */
export async function identifyProduct(input: IdentifyRequestBody): Promise<NormalizedQuery> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (input.mode === "image") {
    if (!input.imageBase64 || !input.imageMediaType) {
      throw new Error("imageBase64 and imageMediaType are required for mode 'image'");
    }
    parts.push({ inlineData: { mimeType: input.imageMediaType, data: input.imageBase64 } });
    parts.push({ text: "Identify the product in this image and respond with the JSON object described in your instructions." });
  } else if (input.mode === "name") {
    if (!input.name) {
      throw new Error("name is required for mode 'name'");
    }
    parts.push({ text: `Product name: "${input.name}"\n\nNormalize this into the JSON object described in your instructions.` });
  } else if (input.mode === "description") {
    if (!input.description) {
      throw new Error("description is required for mode 'description'");
    }
    parts.push({
      text: `Product description: "${input.description}"\n\nIdentify the product and respond with the JSON object described in your instructions.`,
    });
  } else {
    throw new Error(`Unsupported mode: ${input.mode}`);
  }

  const accessToken = await getAccessToken();
  const projectId = getGcpProjectId();

  const response = await callVertexGenerateContent(
    MODEL,
    getLocation(),
    projectId,
    accessToken,
    {
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: IDENTIFY_RESPONSE_SCHEMA,
      },
    },
    CALL_TIMEOUT_MS
  );

  const text = extractText(response);
  if (!text.trim()) {
    throw new Error("Model response had no text content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model response was not valid JSON");
  }

  return toNormalizedQuery(parsed);
}
