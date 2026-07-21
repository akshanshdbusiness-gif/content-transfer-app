import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

// Requires the app to have "Authoring and Management GraphQL API" access
// selected in the Marketplace app configuration.

export async function validateItemPath(
  client: ClientSDK,
  path: string,
  sitecoreContextId?: string,
): Promise<string> {
  try {
    const result = await client.mutate("xmc.authoring.graphql", {
      params: {
        ...(sitecoreContextId ? { query: { sitecoreContextId } } : {}),
        body: {
          query: `query ItemExists($path: String!) {
            item(where: { database: "master", path: $path }) {
              itemId
              name
            }
          }`,
          variables: { path },
        },
      },
    });

    // Failed HTTP calls still resolve, with the problem in `error` — surface
    // the real cause instead of a misleading "not found".
    const failure = (result as { error?: unknown }).error;
    if (failure) {
      const detail =
        typeof failure === "object" && failure !== null
          ? ((failure as { detail?: string; title?: string }).detail ??
            (failure as { title?: string }).title ??
            JSON.stringify(failure))
          : String(failure);
      return `Path check failed: ${detail}`;
    }

    const item = result.data?.data?.item as
      | { itemId?: string; name?: string }
      | null
      | undefined;
    if (item?.name) {
      return `✓ Found "${item.name}" (${item.itemId})`;
    }
    return "✗ Item not found on the source environment";
  } catch (err) {
    return `Could not validate path: ${err instanceof Error ? err.message : String(err)}`;
  }
}
