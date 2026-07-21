"use client";

import { Auth0Provider } from "@auth0/auth0-react";

// Custom authorization (full-stack app): the frontend obtains a real Sitecore
// user token via Auth0 and sends it to our API routes, where it is verified.
// Requires SPA client credentials created for the app in the Cloud Portal,
// with this app's URLs registered as allowed callback/origin URLs.

const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? "auth.sitecorecloud.io";
const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? "";
const audience =
  process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ?? "https://api-webapp.sitecorecloud.io";
const scope =
  process.env.NEXT_PUBLIC_AUTH0_SCOPE ?? "openid profile email offline_access";
const organizationId = process.env.NEXT_PUBLIC_SITECORE_ORG_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      useRefreshTokens
      cacheLocation="localstorage"
      authorizationParams={{
        audience,
        scope,
        // Sitecore org ids (org_...) are Auth0 Organizations ids: pass the
        // standard `organization` param (used by Auth0 itself) and the
        // `organization_id` custom param (used by Sitecore's login actions).
        // Without org context the token endpoint tries an interactive
        // redirect and fails with "Redirection is not available".
        ...(organizationId
          ? { organization: organizationId, organization_id: organizationId }
          : {}),
        redirect_uri:
          typeof window !== "undefined" ? window.location.origin : undefined,
      }}
    >
      {children}
    </Auth0Provider>
  );
}
