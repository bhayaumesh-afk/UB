import { JWT } from "google-auth-library";

// Auth for the Vertex AI Gemini price provider: a JWT service-account client built
// from GCP_SERVICE_ACCOUNT_JSON, exactly per google-auth-library's documented shape
// (JWT built from email/key, getAccessToken() returns { token, expirationTime }).
// The library handles token caching/refresh internally — no separate cache needed.
//
// Initialization is lazy (deferred to first use) rather than running at module load
// time. A literal top-level `JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON!)` would
// throw as soon as this module is imported — which happens on every request that
// imports lib/providers/index.ts, including deployments where SERPAPI_KEY is set (or
// neither key is set, i.e. demo mode) and GCP_SERVICE_ACCOUNT_JSON is intentionally
// unset. Laziness confines the "missing/malformed config" failure to only the
// requests that actually try to use this provider, per lib/providers/index.ts's
// precedence check, while still failing loudly (never silently) once it's used.

interface ServiceAccountKeys {
  client_email: string;
  private_key: string;
  project_id: string;
}

let keys: ServiceAccountKeys | undefined;
let client: JWT | undefined;

function ensureInitialized(): { keys: ServiceAccountKeys; client: JWT } {
  if (keys && client) {
    return { keys, client };
  }

  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never include the raw value in the error — it's a credential.
    throw new Error("GCP_SERVICE_ACCOUNT_JSON failed to parse as JSON");
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.client_email !== "string" ||
    typeof obj.private_key !== "string" ||
    typeof obj.project_id !== "string"
  ) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is missing required fields (client_email, private_key, project_id)");
  }

  keys = obj as unknown as ServiceAccountKeys;
  client = new JWT({
    email: keys.client_email,
    key: keys.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  return { keys, client };
}

export async function getAccessToken(): Promise<string> {
  const { client } = ensureInitialized();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Vertex AI auth: no access token returned");
  return token;
}

export function getGcpProjectId(): string {
  return ensureInitialized().keys.project_id;
}

/** Test-only helper to reset lazy module state between test cases. */
export function __resetVertexAuthForTests() {
  keys = undefined;
  client = undefined;
}
