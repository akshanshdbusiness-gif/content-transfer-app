import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { AuthError } from "@/src/lib/auth/verify-user";
import { getEnvironment } from "@/src/lib/config";
import { getEnvironmentToken } from "@/src/lib/sitecore/env-token";

// Path check via the CM host's Authoring GraphQL endpoint using the
// environment's automation client. Portal user tokens are not authorized for
// authoring operations, and the marketplace M2M proxy is not provisioned for
// custom-authorization apps — the machine token is the identity that provably
// has authoring rights (it is the same one that runs the transfer).

export async function POST(request: Request) {
  return withOrgAdmin(request, async () => {
    const { itemPath, sourceEnvironment } = (await request.json()) as {
      itemPath?: string;
      sourceEnvironment?: string;
    };
    if (!itemPath?.startsWith("/sitecore/") || !sourceEnvironment) {
      throw new AuthError("itemPath and sourceEnvironment are required", 400);
    }

    const env = getEnvironment(sourceEnvironment);
    const token = await getEnvironmentToken(env);

    const response = await fetch(
      `${env.host}/sitecore/api/authoring/graphql/v1`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `query ItemExists($path: String!) {
            item(where: { database: "master", path: $path }) {
              itemId
              name
            }
          }`,
          variables: { path: itemPath },
        }),
      },
    );

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.detail ?? body?.title ?? "unknown error";
      return NextResponse.json({
        message: `Path check failed (${response.status}): ${detail}`,
      });
    }

    // GraphQL failures come back as HTTP 200 with an errors array — surface
    // them instead of misreporting "not found".
    const errors = body?.errors as Array<{ message?: string }> | undefined;
    if (errors?.length) {
      return NextResponse.json({
        message: `Path check failed: ${errors
          .map((e) => e.message ?? JSON.stringify(e))
          .join("; ")}`,
      });
    }

    const item = body?.data?.item as
      | { itemId?: string; name?: string }
      | null
      | undefined;
    return NextResponse.json({
      message: item?.name
        ? `✓ Found "${item.name}" (${item.itemId})`
        : "✗ Item not found on the source environment",
    });
  });
}
