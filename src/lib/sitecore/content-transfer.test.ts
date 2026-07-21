import { afterEach, describe, expect, it, vi } from "vitest";
import { getTransferStatus } from "./content-transfer";

const OPTIONS = { host: "https://cm.example", token: "test-token" };

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("getTransferStatus", () => {
  it("treats 404 as not-found (CFW-9663 early-status delay)", async () => {
    mockFetch(404);
    await expect(getTransferStatus(OPTIONS, "t1")).resolves.toBe("not-found");
  });

  it("calls the status endpoint with the bearer token", async () => {
    const fetchMock = mockFetch(200, { State: "Executing" });
    await getTransferStatus(OPTIONS, "t1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://cm.example/sitecore/api/content/transfer/v1/transfers/t1/status",
    );
    expect(init.headers.authorization).toBe("Bearer test-token");
  });

  it("reports an executing transfer as incomplete", async () => {
    mockFetch(200, { State: "Executing", ChunkSetsMetadata: [] });
    const status = await getTransferStatus(OPTIONS, "t1");
    expect(status).not.toBe("not-found");
    if (status === "not-found") throw new Error("unreachable");
    expect(status.isComplete).toBe(false);
    expect(status.isFailed).toBe(false);
  });

  it("parses ChunkSetsMetadata (the field the API actually returns)", async () => {
    mockFetch(200, {
      State: "Completed",
      ChunkSetsMetadata: [
        { ChunkSetId: "cs-1", ChunkCount: 3, TotalItemCount: 12 },
        { ChunkSetId: "cs-2", ChunkCount: 1, TotalItemCount: 2 },
      ],
    });
    const status = await getTransferStatus(OPTIONS, "t1");
    if (status === "not-found") throw new Error("unreachable");
    expect(status.isComplete).toBe(true);
    expect(status.chunkSets).toEqual([
      { chunkSetId: "cs-1", chunkCount: 3 },
      { chunkSetId: "cs-2", chunkCount: 1 },
    ]);
  });

  it("still accepts the legacy ChunkSets field", async () => {
    mockFetch(200, {
      State: "Completed",
      ChunkSets: [{ ChunkSetId: "cs-1", ChunkCount: 2 }],
    });
    const status = await getTransferStatus(OPTIONS, "t1");
    if (status === "not-found") throw new Error("unreachable");
    expect(status.chunkSets).toEqual([{ chunkSetId: "cs-1", chunkCount: 2 }]);
  });

  it("flags failed transfers", async () => {
    mockFetch(200, { State: "Failed" });
    const status = await getTransferStatus(OPTIONS, "t1");
    if (status === "not-found") throw new Error("unreachable");
    expect(status.isFailed).toBe(true);
  });

  it("throws on unexpected HTTP errors", async () => {
    mockFetch(500, { detail: "boom" });
    await expect(getTransferStatus(OPTIONS, "t1")).rejects.toThrow(
      "Get transfer status failed (500)",
    );
  });
});
