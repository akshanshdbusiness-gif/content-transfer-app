import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock jose so no real JWKS fetch / signature check happens — these tests
// cover OUR claim logic (org + role checks), not jose's crypto.
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";
import { AuthError, verifyOrgAdmin } from "./verify-user";

const ORG = "org_test123";
process.env.SITECORE_ORG_ID = ORG;

const jwtVerifyMock = vi.mocked(jwtVerify);

function requestWithToken(token = "a.b.c"): Request {
  return new Request("https://app.example/api/x", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function stubPayload(payload: Record<string, unknown>) {
  jwtVerifyMock.mockResolvedValue({ payload } as never);
}

async function rejectionFrom(request: Request): Promise<AuthError> {
  try {
    await verifyOrgAdmin(request);
  } catch (err) {
    return err as AuthError;
  }
  throw new Error("expected verifyOrgAdmin to reject");
}

beforeEach(() => jwtVerifyMock.mockReset());

describe("verifyOrgAdmin", () => {
  it("rejects requests without a bearer token", async () => {
    const bare = new Request("https://app.example/api/x");
    await expect(verifyOrgAdmin(bare)).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Missing bearer token"),
    });
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects tokens that fail verification", async () => {
    // Async throw → rejected promise that verifyOrgAdmin awaits immediately, so
    // it is handled. (The `.rejects` matcher separately reports the mock's own
    // throw, so use the manual catch helper here.)
    jwtVerifyMock.mockImplementationOnce(async () => {
      throw new Error("signature mismatch");
    });
    const err = await rejectionFrom(requestWithToken());
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("Token verification failed");
  });

  it("rejects tokens from a different organization", async () => {
    stubPayload({
      sub: "auth0|1",
      org_id: "org_other",
      roles: ["Organization Admin"],
    });
    await expect(verifyOrgAdmin(requestWithToken())).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("organization"),
    });
  });

  it("rejects org members without an admin role", async () => {
    stubPayload({ sub: "auth0|1", org_id: ORG, roles: ["Author"] });
    await expect(verifyOrgAdmin(requestWithToken())).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("Organization Admin"),
    });
  });

  it("rejects tokens with no roles claim at all", async () => {
    stubPayload({ sub: "auth0|1", org_id: ORG });
    await expect(verifyOrgAdmin(requestWithToken())).rejects.toMatchObject({
      status: 403,
    });
  });

  it("accepts an Organization Admin", async () => {
    stubPayload({
      sub: "auth0|admin",
      org_id: ORG,
      roles: ["Organization Admin"],
    });
    await expect(verifyOrgAdmin(requestWithToken())).resolves.toEqual({
      sub: "auth0|admin",
      orgId: ORG,
      roles: ["Organization Admin"],
    });
  });

  it("accepts an Organization Owner via namespaced claims", async () => {
    stubPayload({
      sub: "auth0|owner",
      "https://auth.sitecorecloud.io/claims/org_id": ORG,
      "https://auth.sitecorecloud.io/claims/roles": ["Organization Owner"],
    });
    const user = await verifyOrgAdmin(requestWithToken());
    expect(user.roles).toContain("Organization Owner");
  });

  it("AuthError carries an HTTP status", () => {
    const err = new AuthError("nope", 403);
    expect(err.status).toBe(403);
    expect(err.message).toBe("nope");
  });
});
