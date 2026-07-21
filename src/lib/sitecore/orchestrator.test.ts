import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
  getEnvironment: vi.fn((name: string) => ({
    name,
    host: `https://${name}.example`,
    clientId: "id",
    clientSecret: "secret",
  })),
}));
vi.mock("./env-token", () => ({
  getEnvironmentToken: vi.fn(async () => "machine-token"),
}));
vi.mock("./content-transfer", () => ({
  initiateTransfer: vi.fn(async () => undefined),
  getTransferStatus: vi.fn(),
  downloadChunk: vi.fn(async () => ({
    data: new ArrayBuffer(8),
    isMedia: false,
  })),
  uploadChunk: vi.fn(async () => undefined),
  completeChunkSet: vi.fn(async () => undefined),
}));
vi.mock("./item-transfer", () => ({
  blobNameFor: vi.fn(
    (transferId: string, chunkSetId: string) =>
      `contentTransfer-${transferId}-${chunkSetId}.raif`,
  ),
  consumeBlob: vi.fn(async () => undefined),
  getBlobStatus: vi.fn(async () => ({ raw: {}, isTransferred: true })),
}));

import {
  completeChunkSet,
  downloadChunk,
  getTransferStatus,
  initiateTransfer,
  uploadChunk,
} from "./content-transfer";
import { consumeBlob } from "./item-transfer";
import { runTransfer } from "./orchestrator";
import type { TransferJob } from "../types";

function makeJob(): TransferJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    transferId: "transfer-1",
    status: "pending",
    request: {
      items: [
        { itemPath: "/sitecore/content/a", scope: "ItemAndDescendants" },
        { itemPath: "/sitecore/content/b", scope: "SingleItem" },
      ],
      mergeStrategy: "OverrideExistingItem",
      database: "master",
      sourceEnvironment: "dev",
      targetEnvironment: "qa",
    },
    requestedBy: "auth0|tester",
    log: [],
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("runTransfer", () => {
  it("runs the full pipeline: initiate, chunks source->target, complete, consume", async () => {
    vi.mocked(getTransferStatus).mockResolvedValue({
      raw: { State: "Completed" },
      isComplete: true,
      isFailed: false,
      chunkSets: [{ chunkSetId: "cs-1", chunkCount: 2 }],
    });

    const job = makeJob();
    const messages: string[] = [];
    await runTransfer(job, (m) => messages.push(m));

    expect(job.status).toBe("completed");
    expect(job.error).toBeUndefined();

    // Initiate on the source with both items in one operation.
    expect(initiateTransfer).toHaveBeenCalledWith(
      { host: "https://dev.example", token: "machine-token" },
      expect.objectContaining({
        transferId: "transfer-1",
        items: job.request.items,
        mergeStrategy: "OverrideExistingItem",
      }),
    );

    // Both chunks moved from source to target.
    expect(downloadChunk).toHaveBeenCalledTimes(2);
    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadChunk).mock.calls[0][0]).toEqual({
      host: "https://qa.example",
      token: "machine-token",
    });

    expect(completeChunkSet).toHaveBeenCalledWith(
      expect.anything(),
      "transfer-1",
      "cs-1",
    );
    expect(consumeBlob).toHaveBeenCalledWith(
      expect.anything(),
      "master",
      "contentTransfer-transfer-1-cs-1.raif",
    );

    // Streaming log tells the story, including per-item lines.
    expect(messages.some((m) => m.includes("/sitecore/content/a"))).toBe(true);
    expect(messages.at(-1)).toBe("Transfer completed");
  });

  it("processes every chunk set of a multi-item transfer", async () => {
    vi.mocked(getTransferStatus).mockResolvedValue({
      raw: { State: "Completed" },
      isComplete: true,
      isFailed: false,
      chunkSets: [
        { chunkSetId: "cs-1", chunkCount: 1 },
        { chunkSetId: "cs-2", chunkCount: 3 },
      ],
    });

    const job = makeJob();
    await runTransfer(job);

    expect(job.status).toBe("completed");
    expect(downloadChunk).toHaveBeenCalledTimes(4);
    expect(completeChunkSet).toHaveBeenCalledTimes(2);
    expect(consumeBlob).toHaveBeenCalledTimes(2);
  });

  it("fails the job when the source reports a failed transfer", async () => {
    vi.mocked(getTransferStatus).mockResolvedValue({
      raw: { State: "Failed", Reason: "kaboom" },
      isComplete: false,
      isFailed: true,
      chunkSets: [],
    });

    const job = makeJob();
    await runTransfer(job);

    expect(job.status).toBe("failed");
    expect(job.error).toContain("Source reported transfer failure");
    expect(downloadChunk).not.toHaveBeenCalled();
  });

  it("fails the job when initiation throws, without crashing the stream", async () => {
    vi.mocked(initiateTransfer).mockImplementation(() =>
      Promise.reject(new Error("Initiate transfer failed (403): forbidden")),
    );

    const job = makeJob();
    const messages: string[] = [];
    await runTransfer(job, (m) => messages.push(m));

    expect(job.status).toBe("failed");
    expect(job.error).toContain("403");
    expect(messages.at(-1)).toContain("Transfer failed");
  });
});
