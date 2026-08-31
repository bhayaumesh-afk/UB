// Shared raw-REST helpers for calling the Vertex AI generateContent endpoint directly
// (no SDK — see lib/providers/gemini.ts and lib/identify.ts for why). Both the price
// provider and the product-identify pipeline call this same endpoint shape, just with
// different prompts/tools/schemas, so the fetch/timeout/parsing plumbing lives here once.

export interface GenerateContentPart {
  text?: string;
}

export interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

export interface GroundingChunk {
  web?: GroundingChunkWeb;
}

export interface GenerateContentCandidate {
  content?: { parts?: GenerateContentPart[] };
  groundingMetadata?: {
    groundingChunks?: GroundingChunk[];
    searchEntryPoint?: { renderedContent?: string };
  };
}

export interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function callVertexGenerateContent(
  model: string,
  location: string,
  projectId: string,
  accessToken: string,
  body: unknown,
  timeoutMs: number
): Promise<GenerateContentResponse> {
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  if (!res.ok) {
    throw new Error(`Vertex AI generateContent failed with HTTP ${res.status}`);
  }
  return res.json();
}

export function extractText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p): p is { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}
