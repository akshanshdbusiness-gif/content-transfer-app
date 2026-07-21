import { describe, expect, it } from "vitest";
import { AuthError } from "./auth/verify-user";
import { MAX_ITEMS, validateTransferRequest } from "./validate-transfer";

const ENVS = ["dev", "qa"];

const validBody = () => ({
  items: [
    { itemPath: "/sitecore/content/site/Home", scope: "ItemAndDescendants" },
  ],
  mergeStrategy: "OverrideExistingItem",
  sourceEnvironment: "dev",
  targetEnvironment: "qa",
});

function errorFor(body: unknown): AuthError {
  try {
    validateTransferRequest(body, ENVS);
  } catch (err) {
    return err as AuthError;
  }
  throw new Error("expected validation to fail");
}

describe("validateTransferRequest", () => {
  it("accepts a valid single-item request and defaults database to master", () => {
    const result = validateTransferRequest(validBody(), ENVS);
    expect(result.database).toBe("master");
    expect(result.items).toEqual([
      { itemPath: "/sitecore/content/site/Home", scope: "ItemAndDescendants" },
    ]);
  });

  it("accepts multiple items and trims paths", () => {
    const result = validateTransferRequest(
      {
        ...validBody(),
        items: [
          { itemPath: "  /sitecore/content/a  ", scope: "SingleItem" },
          { itemPath: "/sitecore/media library/b", scope: "ItemAndDescendants" },
        ],
      },
      ENVS,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0].itemPath).toBe("/sitecore/content/a");
  });

  it("rejects an empty item list", () => {
    const err = errorFor({ ...validBody(), items: [] });
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("at least one item");
  });

  it("rejects more than MAX_ITEMS items", () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({
      itemPath: `/sitecore/content/${i}`,
      scope: "SingleItem",
    }));
    expect(errorFor({ ...validBody(), items }).message).toContain(
      `at most ${MAX_ITEMS}`,
    );
  });

  it("rejects paths outside /sitecore/ with the item index", () => {
    const err = errorFor({
      ...validBody(),
      items: [
        { itemPath: "/sitecore/content/ok", scope: "SingleItem" },
        { itemPath: "C:\\evil", scope: "SingleItem" },
      ],
    });
    expect(err.message).toContain("items[1].itemPath");
  });

  it("rejects unknown scopes and merge strategies", () => {
    expect(
      errorFor({
        ...validBody(),
        items: [{ itemPath: "/sitecore/content/a", scope: "Everything" }],
      }).message,
    ).toContain("items[0].scope");
    expect(
      errorFor({ ...validBody(), mergeStrategy: "YOLO" }).message,
    ).toContain("mergeStrategy");
  });

  it("rejects unconfigured environments", () => {
    expect(
      errorFor({ ...validBody(), sourceEnvironment: "prod" }).message,
    ).toContain("sourceEnvironment");
  });

  it("rejects identical source and target", () => {
    expect(
      errorFor({ ...validBody(), targetEnvironment: "dev" }).message,
    ).toContain("must differ");
  });

  it("collects every problem in one message", () => {
    const err = errorFor({ items: [], mergeStrategy: "nope" });
    expect(err.message).toContain("at least one item");
    expect(err.message).toContain("mergeStrategy");
    expect(err.message).toContain("sourceEnvironment");
  });
});
