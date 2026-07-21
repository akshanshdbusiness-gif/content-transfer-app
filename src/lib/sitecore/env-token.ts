import { authConfig, type EnvironmentConfig } from "../config";

// Machine (client-credentials) tokens per environment. The transfer APIs are
// called with these; the automation clients must belong to an identity with
// Organization Admin/Owner rights — the Content Transfer API enforces that
// role server-side as well.

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export async function getEnvironmentToken(
  env: EnvironmentConfig,
): Promise<string> {
  const cached = tokenCache.get(env.name);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch(`${authConfig.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.clientId,
      client_secret: env.clientSecret,
      audience: authConfig.machineTokenAudience,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get token for environment "${env.name}" (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache.set(env.name, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
