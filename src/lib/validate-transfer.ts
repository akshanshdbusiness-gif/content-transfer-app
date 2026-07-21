import { AuthError } from "./auth/verify-user";
import {
  MERGE_STRATEGIES,
  TRANSFER_SCOPES,
  type TransferRequest,
} from "./types";

export const MAX_ITEMS = 50;

/**
 * Validates and normalizes a transfer request body. Pure — the caller supplies
 * the list of configured environment names. Throws AuthError(400) with all
 * problems joined, so the user sees every issue at once.
 */
export function validateTransferRequest(
  body: unknown,
  environmentNames: string[],
): TransferRequest {
  const b = body as Partial<TransferRequest>;
  const errors: string[] = [];

  const items = (Array.isArray(b.items) ? b.items : []).map((item) => ({
    ...item,
    itemPath: item?.itemPath?.trim() ?? "",
  }));
  if (items.length === 0) {
    errors.push("at least one item is required");
  }
  if (items.length > MAX_ITEMS) {
    errors.push(`at most ${MAX_ITEMS} items per transfer`);
  }
  items.forEach((item, i) => {
    if (!item.itemPath.startsWith("/sitecore/")) {
      errors.push(`items[${i}].itemPath must be a full path under /sitecore/`);
    }
    if (!TRANSFER_SCOPES.includes(item?.scope as never)) {
      errors.push(
        `items[${i}].scope must be one of: ${TRANSFER_SCOPES.join(", ")}`,
      );
    }
  });
  if (!MERGE_STRATEGIES.includes(b.mergeStrategy as never)) {
    errors.push(`mergeStrategy must be one of: ${MERGE_STRATEGIES.join(", ")}`);
  }
  if (!b.sourceEnvironment || !environmentNames.includes(b.sourceEnvironment)) {
    errors.push("sourceEnvironment is not a configured environment");
  }
  if (!b.targetEnvironment || !environmentNames.includes(b.targetEnvironment)) {
    errors.push("targetEnvironment is not a configured environment");
  }
  if (b.sourceEnvironment === b.targetEnvironment) {
    errors.push("source and target environments must differ");
  }

  if (errors.length > 0) {
    throw new AuthError(errors.join("; "), 400);
  }

  return {
    items: items.map((item) => ({
      itemPath: item.itemPath,
      scope: item.scope,
    })),
    mergeStrategy: b.mergeStrategy!,
    database: b.database?.trim() || "master",
    sourceEnvironment: b.sourceEnvironment!,
    targetEnvironment: b.targetEnvironment!,
  };
}
