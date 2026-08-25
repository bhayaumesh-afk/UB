import crypto from "crypto";
import type { NormalizedQuery, Offer } from "@/types";
import { convertToUsd } from "@/lib/currency";
import { extractJson } from "@/lib/anthropic";
import type { PriceProvider } from "./types";

// Alternative live price source: Gemini on Vertex AI with Google Search grounding,
// authenticated via a service-account JSON credential. Used when SERPAPI_KEY is not
// set but GOOGLE_VERTEX_CREDENTIALS_JSON is.
//
// Caveat (confirmed in manual testing): unlike SerpApi's structured Google Shopping
// feed, this asks a generative model to summarize search results into JSON. It can
// return the same price for multiple stores, and offer URLs are Google grounding
// redirect links (vertexaisearch.cloud.google.com/grounding-api-redirect/...) rather
// than direct retailer URLs. Treat this provider as lower-confidence than SerpApi.

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_LOCATION = "us-central1";
const DEFAULT_MODEL = "gemini-2.5-flash";
const TOKEN_TTL_MS = 55 * 60 * 1000; // access tokens last 60min; refresh a bit early

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseCredentials(raw: string): ServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_VERTEX_CREDENTIALS_JSON is not valid JSON");
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.client_email !== "string" ||
    typeof obj.private_key !== "string" ||
    typeof obj.project_id !== "string" ||
    typeof obj.token_uri !== "string"
  ) {
    throw new Error("GOOGLE_VERTEX_CREDENTIALS_JSON is missing required service-account fields");
  }
  return obj as unknown as ServiceAccountCredentials;
}

async function getAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const cacheKey = creds.client_email;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: creds.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(creds.private_key));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Vertex AI token exchange failed with HTTP ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Vertex AI token exchange response had no access_token");
  }
  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return data.access_token;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface RawOffer {
  store?: unknown;
  price?: unknown;
  currency?: unknown;
  url?: unknown;
}

/** Exported for unit testing: turns the model's raw JSON text into validated Offer objects (USD conversion applied separately). */
export function parseOffersFromModelText(text: string): { store: string; price: number; currency: string; url: string }[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON array");
  }
  const offers: { store: string; price: number; currency: string; url: string }[] = [];
  for (const item of parsed as RawOffer[]) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.store !== "string" ||
      typeof item.price !== "number" ||
      !(item.price > 0) ||
      typeof item.url !== "string"
    ) {
      continue;
    }
    offers.push({
      store: item.store,
      price: item.price,
      currency: typeof item.currency === "string" ? item.currency : "USD",
      url: item.url,
    });
  }
  return offers;
}

export class VertexGeminiPriceProvider implements PriceProvider {
  readonly name = "vertex-gemini" as const;
  private readonly credentials: ServiceAccountCredentials;
  private readonly location: string;
  private readonly model: string;

  constructor(credentialsJson: string, location?: string, model?: string) {
    this.credentials = parseCredentials(credentialsJson);
    this.location = location && location.trim() ? location : DEFAULT_LOCATION;
    this.model = model && model.trim() ? model : DEFAULT_MODEL;
  }

  async search(query: NormalizedQuery): Promise<Offer[]> {
    const accessToken = await getAccessToken(this.credentials);
    const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.credentials.project_id}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;

    const prompt = `Search the web for current real prices of "${query.query}" from at least 3 different online retailers.
Use distinct, accurate, current prices per retailer — do not repeat the same price across stores unless you have confirmed they genuinely match.
Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped like:
[{"store": string, "price": number, "currency": string, "url": string}]`;

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
        }),
      },
      REQUEST_TIMEOUT_MS
    );

    if (!res.ok) {
      throw new Error(`Vertex AI generateContent failed with HTTP ${res.status}`);
    }
    const data = await res.json();
    const textPart = data?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => typeof p.text === "string");
    if (!textPart?.text) {
      throw new Error("Vertex AI response had no text content");
    }

    const rawOffers = parseOffersFromModelText(textPart.text);
    const offers: Offer[] = [];
    for (const raw of rawOffers) {
      try {
        const conversion = await convertToUsd(raw.price, raw.currency);
        offers.push({
          store: raw.store,
          price: Math.round(conversion.amountUsd * 100) / 100,
          originalCurrency: conversion.converted ? raw.currency.toUpperCase() : undefined,
          originalPrice: conversion.converted ? raw.price : undefined,
          url: raw.url,
        });
      } catch {
        // Skip offers whose currency can't be converted rather than showing a wrong price.
      }
    }

    return offers.sort((a, b) => a.price - b.price);
  }
}
