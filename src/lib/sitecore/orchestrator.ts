import { getEnvironment } from "../config";
import type { TransferJob } from "../types";
import {
  completeChunkSet,
  downloadChunk,
  getTransferStatus,
  initiateTransfer,
  uploadChunk,
} from "./content-transfer";
import { getEnvironmentToken } from "./env-token";
import { blobNameFor, consumeBlob, getBlobStatus } from "./item-transfer";
import { appendLog, saveJob } from "./job-store";

const STATUS_POLL_INTERVAL_MS = 10_000;
// CFW-9663: status can 404 for 3-5 minutes after initiation, so the poll
// budget must comfortably exceed that window.
const STATUS_POLL_TIMEOUT_MS = 15 * 60_000;
const CONSUME_POLL_INTERVAL_MS = 10_000;
const CONSUME_POLL_TIMEOUT_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the full 7-step transfer pipeline:
 * source: initiate -> poll status -> download chunks
 * target: upload chunks -> complete chunk set -> consume .raif -> verify blob
 */
export async function runTransfer(
  job: TransferJob,
  onLog?: (message: string) => void,
): Promise<void> {
  const { request } = job;
  const log = (message: string) => {
    appendLog(job, message);
    onLog?.(message);
  };
  try {
    job.status = "running";
    saveJob(job);

    const sourceEnv = getEnvironment(request.sourceEnvironment);
    const targetEnv = getEnvironment(request.targetEnvironment);

    log(`Acquiring tokens for ${sourceEnv.name} and ${targetEnv.name}`);
    const [sourceToken, targetToken] = await Promise.all([
      getEnvironmentToken(sourceEnv),
      getEnvironmentToken(targetEnv),
    ]);
    const source = { host: sourceEnv.host, token: sourceToken };
    const target = { host: targetEnv.host, token: targetToken };

    log(
      `Step 1/7 - initiating transfer of ${request.items.length} item(s) (${request.mergeStrategy}) on ${sourceEnv.name}`,
    );
    for (const item of request.items) {
      log(
        `  - ${item.itemPath} (${item.scope === "ItemAndDescendants" ? "with subitems" : "single item"})`,
      );
    }
    await initiateTransfer(source, {
      transferId: job.transferId,
      items: request.items,
      mergeStrategy: request.mergeStrategy,
      database: request.database,
    });

    log("Step 2/7 - waiting for source to package chunk sets");
    const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
    let chunkSets;
    for (;;) {
      const status = await getTransferStatus(source, job.transferId);
      if (status === "not-found") {
        log("Status not available yet (known delay) - retrying");
      } else if (status.isFailed) {
        throw new Error(
          `Source reported transfer failure: ${JSON.stringify(status.raw)}`,
        );
      } else if (status.isComplete && status.chunkSets.length > 0) {
        chunkSets = status.chunkSets;
        break;
      } else {
        const state = String(
          (status.raw as Record<string, unknown>)?.State ?? "unknown",
        );
        log(
          `Source state: ${state} (${status.chunkSets.length} chunk set(s) so far) - waiting`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for source transfer packaging");
      }
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    log(`Source packaged ${chunkSets.length} chunk set(s)`);

    for (const chunkSet of chunkSets) {
      log(
        `Steps 3-4/7 - moving ${chunkSet.chunkCount} chunk(s) for chunk set ${chunkSet.chunkSetId}`,
      );
      for (let i = 0; i < chunkSet.chunkCount; i++) {
        const chunk = await downloadChunk(
          source,
          job.transferId,
          chunkSet.chunkSetId,
          i,
        );
        await uploadChunk(
          target,
          job.transferId,
          chunkSet.chunkSetId,
          i,
          chunk,
        );
        log(`Chunk ${i + 1}/${chunkSet.chunkCount} transferred`);
      }

      log("Step 5/7 - assembling .raif file on target");
      await completeChunkSet(target, job.transferId, chunkSet.chunkSetId);

      const blobName = blobNameFor(job.transferId, chunkSet.chunkSetId);
      log(`Step 6/7 - consuming ${blobName} into ${request.database}`);
      await consumeBlob(target, request.database, blobName);

      log("Step 7/7 - verifying blob state");
      const consumeDeadline = Date.now() + CONSUME_POLL_TIMEOUT_MS;
      for (;;) {
        const blobStatus = await getBlobStatus(target, blobName);
        if (blobStatus.isTransferred) break;
        if (Date.now() > consumeDeadline) {
          throw new Error(`Timed out waiting for ${blobName} to be consumed`);
        }
        await sleep(CONSUME_POLL_INTERVAL_MS);
      }
      log(`Chunk set ${chunkSet.chunkSetId} consumed successfully`);
    }

    job.status = "completed";
    log("Transfer completed");
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    log(`Transfer failed: ${job.error}`);
  }
}
