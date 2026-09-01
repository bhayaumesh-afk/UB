import { NextRequest, NextResponse } from "next/server";
import { identifyProduct, normalizeHeuristically } from "@/lib/identify";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";
import type { IdentifyRequestBody, IdentifyResponseBody } from "@/types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB base64 payload guard (client compresses to ~1MB binary)

export async function POST(req: NextRequest): Promise<NextResponse<IdentifyResponseBody>> {
  const ip = getClientIp(req.headers);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  let body: IdentifyRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.mode || !["image", "name", "description"].includes(body.mode)) {
    return NextResponse.json({ ok: false, error: "mode must be 'image', 'name', or 'description'" }, { status: 400 });
  }

  if (body.mode === "image" && body.imageBase64 && body.imageBase64.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, error: "Image is too large" }, { status: 413 });
  }

  const hasGeminiCredential = Boolean(process.env.GCP_SERVICE_ACCOUNT_JSON);

  if (body.mode === "image" && !hasGeminiCredential) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server is not configured with GCP_SERVICE_ACCOUNT_JSON, which is required to identify products from a photo.",
      },
      { status: 503 }
    );
  }

  try {
    const result = hasGeminiCredential ? await identifyProduct(body) : normalizeHeuristically(body);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // Never log raw image payloads or API keys — just the error message.
    console.error("identify error:", err instanceof Error ? err.message : "unknown error");

    // Graceful degradation for text modes: fall back to a heuristic normalization
    // rather than a hard failure if the model call errors out.
    if (body.mode !== "image") {
      try {
        const result = normalizeHeuristically(body);
        return NextResponse.json({ ok: true, result });
      } catch {
        // fall through to error response below
      }
    }

    return NextResponse.json(
      { ok: false, error: "Could not identify the product. Please try a clearer image or more specific text." },
      { status: 502 }
    );
  }
}
