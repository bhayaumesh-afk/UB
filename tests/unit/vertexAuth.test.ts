import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessTokenMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(async (): Promise<{ token: string | null }> => ({ token: "fake-access-token" })),
}));

vi.mock("google-auth-library", () => ({
  JWT: vi.fn().mockImplementation(() => ({ getAccessToken: getAccessTokenMock })),
}));

import { getAccessToken, getGcpProjectId, __resetVertexAuthForTests } from "@/lib/providers/vertexAuth";

const FAKE_SA_JSON = JSON.stringify({
  client_email: "test@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  project_id: "test-project",
});

describe("vertexAuth", () => {
  const originalEnv = process.env.GCP_SERVICE_ACCOUNT_JSON;

  beforeEach(async () => {
    __resetVertexAuthForTests();
    getAccessTokenMock.mockClear();
    getAccessTokenMock.mockResolvedValue({ token: "fake-access-token" });
    const { JWT } = await import("google-auth-library");
    vi.mocked(JWT).mockClear();
    delete process.env.GCP_SERVICE_ACCOUNT_JSON;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.GCP_SERVICE_ACCOUNT_JSON = originalEnv;
    } else {
      delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    }
  });

  it("throws when GCP_SERVICE_ACCOUNT_JSON is not set — a config error, not a silent fallback", async () => {
    await expect(getAccessToken()).rejects.toThrow("GCP_SERVICE_ACCOUNT_JSON is not configured");
  });

  it("throws when GCP_SERVICE_ACCOUNT_JSON is malformed JSON", async () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = "not json";
    await expect(getAccessToken()).rejects.toThrow(/failed to parse/);
  });

  it("throws when required fields are missing from the parsed JSON", async () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "x" });
    await expect(getAccessToken()).rejects.toThrow(/missing required fields/);
  });

  it("returns the access token from the JWT client when properly configured", async () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SA_JSON;
    await expect(getAccessToken()).resolves.toBe("fake-access-token");
    expect(getAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it("exposes the project id parsed straight from the service-account JSON", () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SA_JSON;
    expect(getGcpProjectId()).toBe("test-project");
  });

  it("throws when the JWT client resolves with no token", async () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SA_JSON;
    getAccessTokenMock.mockResolvedValueOnce({ token: null });
    await expect(getAccessToken()).rejects.toThrow(/no access token returned/);
  });

  it("reuses the same JWT client across calls instead of re-parsing the credential every time", async () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = FAKE_SA_JSON;
    await getAccessToken();
    await getAccessToken();
    expect(getAccessTokenMock).toHaveBeenCalledTimes(2);
    // JWT constructor itself should only have been invoked once (lazy singleton).
    const { JWT } = await import("google-auth-library");
    expect(vi.mocked(JWT)).toHaveBeenCalledTimes(1);
  });
});
