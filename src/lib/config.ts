// Server-side configuration. All secrets live here (env vars) and are never
// exposed to the browser — only NEXT_PUBLIC_* values reach the client bundle.

export interface EnvironmentConfig {
  /** Display name used in the source/target dropdowns, e.g. "dev", "qa", "prod". */
  name: string;
  /** CM host of the environment, e.g. https://xmc-org-project-env.sitecorecloud.io */
  host: string;
  /** Automation client (client-credentials) for this environment. */
  clientId: string;
  clientSecret: string;
  /** Optional sitecoreContextId (preview) — enables the item-path check via
   * the Authoring GraphQL API. Found in XM Cloud Deploy environment details. */
  contextId?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const authConfig = {
  /** Sitecore Cloud auth server (Auth0 tenant). */
  domain: process.env.SITECORE_AUTH_DOMAIN ?? "https://auth.sitecorecloud.io",
  /** Audience of the *user* token the frontend sends us. */
  userTokenAudience:
    process.env.SITECORE_USER_TOKEN_AUDIENCE ??
    "https://api-webapp.sitecorecloud.io",
  /** Audience requested for the *machine* tokens used against SitecoreAI APIs. */
  machineTokenAudience:
    process.env.SITECORE_MACHINE_TOKEN_AUDIENCE ?? "https://api.sitecorecloud.io",
  get organizationId(): string {
    return required("SITECORE_ORG_ID");
  },
  /**
   * Role values (substring match) accepted as admin. Inspect a real user token
   * (jwt.io) and adjust SITECORE_ADMIN_ROLE_PATTERNS if your tenant uses
   * different role names.
   */
  adminRolePatterns: (
    process.env.SITECORE_ADMIN_ROLE_PATTERNS ??
    "Organization Admin,Organization Owner"
  )
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean),
};

let cachedEnvironments: EnvironmentConfig[] | undefined;

/**
 * SITECORE_ENVIRONMENTS is a JSON array:
 * [{"name":"dev","host":"https://...","clientId":"...","clientSecret":"..."}, ...]
 */
export function getEnvironments(): EnvironmentConfig[] {
  if (cachedEnvironments) return cachedEnvironments;
  const raw = required("SITECORE_ENVIRONMENTS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SITECORE_ENVIRONMENTS is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SITECORE_ENVIRONMENTS must be a non-empty JSON array");
  }
  for (const env of parsed) {
    for (const key of ["name", "host", "clientId", "clientSecret"]) {
      if (typeof env?.[key] !== "string" || !env[key]) {
        throw new Error(`SITECORE_ENVIRONMENTS entry is missing "${key}"`);
      }
    }
  }
  cachedEnvironments = (parsed as EnvironmentConfig[]).map((e) => ({
    ...e,
    host: e.host.replace(/\/$/, ""),
  }));
  return cachedEnvironments;
}

export function getEnvironment(name: string): EnvironmentConfig {
  const env = getEnvironments().find((e) => e.name === name);
  if (!env) {
    throw new Error(`Unknown environment "${name}"`);
  }
  return env;
}
