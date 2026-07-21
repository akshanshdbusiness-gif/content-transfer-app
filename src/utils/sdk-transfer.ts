import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { MergeStrategy, TransferItemInput } from "@/src/lib/types";

// SDK-native transfer pipeline: runs the whole flow in the browser through the
// Marketplace SDK's typed xmc.contentTransfer.* operations with built-in
// authorization — no backend, no automation clients. Requires the Content
// Transfer API to be selectable/granted in the app's API access configuration.
//
// Trade-offs vs. the backend pipeline (src/lib/sitecore/orchestrator.ts):
// - Built-in auth exchanges the user token for an admin machine token, so the
//   individual user's role is NOT enforced by the platform and audit logs show
//   a generic Marketplace user. The UI-level role check is the only gate.
// - Chunks stream through the user's browser tab; closing the tab aborts the
//   transfer.

export interface SdkTransferInput {
  transferId: string;
  items: TransferItemInput[];
  mergeStrategy: MergeStrategy;
  database: string;
  /** sitecoreContextId of the source environment (resourceAccess[].context). */
  sourceContextId: string;
  /** sitecoreContextId of the target environment. */
  targetContextId: string;
  onLog: (message: string) => void;
}

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unwrap the nested QueryResult/RequestResult `.data` layers. */
function unwrap<T>(result: unknown): T {
  let current: unknown = result;
  for (let i = 0; i < 3; i++) {
    if (
      current instanceof Blob ||
      current === null ||
      typeof current !== "object" ||
      !("data" in current)
    ) {
      break;
    }
    current = (current as { data: unknown }).data;
  }
  return current as T;
}

export async function runSdkTransfer(
  client: ClientSDK,
  input: SdkTransferInput,
): Promise<void> {
  const { transferId, onLog } = input;
  const source = { sitecoreContextId: input.sourceContextId };
  const target = { sitecoreContextId: input.targetContextId };

  onLog(
    `Step 1 — creating transfer for ${input.items.length} item(s) (${input.mergeStrategy})`,
  );
  await client.mutate("xmc.contentTransfer.createContentTransfer", {
    params: {
      query: source,
      body: {
        transferId,
        configuration: {
          dataTrees: input.items.map((item) => ({
            itemPath: item.itemPath,
            scope: item.scope,
            mergeStrategy: input.mergeStrategy,
          })),
        },
      },
    },
  });

  onLog("Step 2 — waiting for the source to package chunk sets");
  const statusDeadline = Date.now() + POLL_TIMEOUT_MS;
  let chunkSets: Array<{ ChunkSetId: string; ChunkCount: number }> = [];
  for (;;) {
    try {
      const res = await client.query(
        "xmc.contentTransfer.getContentTransferStatus",
        { params: { path: { transferId }, query: source } },
      );
      const status = unwrap<{
        State: string;
        ChunkSetsMetadata: Array<{ ChunkSetId: string; ChunkCount: number }>;
      }>(res);
      if (/fail|error/i.test(status?.State ?? "")) {
        throw new Error(`Source reported state "${status.State}"`);
      }
      if (
        /complete/i.test(status?.State ?? "") &&
        (status.ChunkSetsMetadata?.length ?? 0) > 0
      ) {
        chunkSets = status.ChunkSetsMetadata;
        break;
      }
      onLog(`Source state: ${status?.State ?? "unknown"} — waiting`);
    } catch (err) {
      // Known issue CFW-9663: status may 404 for the first minutes.
      onLog(
        `Status not available yet (${err instanceof Error ? err.message : "error"}) — retrying`,
      );
    }
    if (Date.now() > statusDeadline) {
      throw new Error("Timed out waiting for source packaging");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  onLog(`Source packaged ${chunkSets.length} chunk set(s)`);

  for (const chunkSet of chunkSets) {
    onLog(
      `Steps 3–4 — moving ${chunkSet.ChunkCount} chunk(s) of set ${chunkSet.ChunkSetId}`,
    );
    for (let chunkId = 0; chunkId < chunkSet.ChunkCount; chunkId++) {
      const chunkRes = await client.query("xmc.contentTransfer.getChunk", {
        params: {
          path: { transferId, chunksetId: chunkSet.ChunkSetId, chunkId },
          query: source,
        },
      });
      const blob = unwrap<Blob>(chunkRes);
      if (!(blob instanceof Blob)) {
        throw new Error(`Chunk ${chunkId} did not return binary data`);
      }

      // Media chunks are flagged via the Content-Disposition header of the
      // download; surface it if the SDK exposes the raw response.
      const rawResponse = (chunkRes as { data?: { response?: Response } })
        ?.data?.response;
      const disposition =
        rawResponse?.headers?.get?.("content-disposition") ?? "";
      const isMedia = /ismedia\s*=?\s*true/i.test(disposition);

      await client.mutate("xmc.contentTransfer.saveChunk", {
        params: {
          path: { transferId, chunksetId: chunkSet.ChunkSetId, chunkId },
          query: { ...target, isMedia },
          body: blob,
        },
      });
      onLog(`Chunk ${chunkId + 1}/${chunkSet.ChunkCount} transferred`);
    }

    onLog("Step 5 — completing chunk set on target");
    const completeRes = await client.mutate(
      "xmc.contentTransfer.completeChunkSetTransfer",
      {
        params: {
          path: { transferId, chunksetId: chunkSet.ChunkSetId },
          query: target,
        },
      },
    );
    const fileName =
      unwrap<{ ContentTransferFileName: string }>(completeRes)
        ?.ContentTransferFileName ??
      `contentTransfer-${transferId}-${chunkSet.ChunkSetId}.raif`;

    onLog(`Step 6 — consuming ${fileName} into ${input.database}`);
    await client.query("xmc.contentTransfer.consumeFile", {
      params: {
        query: { databaseName: input.database, fileName, ...target },
      },
    });

    onLog("Step 7 — waiting for the file to be consumed");
    const consumeDeadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const stateRes = await client.query("xmc.contentTransfer.getBlobState", {
        params: { query: { fileName, ...target } },
      });
      const blobState = unwrap<{ status?: string }>(stateRes);
      if (blobState?.status === "OK") break;
      if (blobState?.status === "Error") {
        throw new Error(`Blob consume failed: ${JSON.stringify(blobState)}`);
      }
      if (Date.now() > consumeDeadline) {
        throw new Error(`Timed out waiting for ${fileName} to be consumed`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    onLog(`Chunk set ${chunkSet.ChunkSetId} consumed successfully`);
  }

  onLog("Transfer completed");
}
