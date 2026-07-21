import type { MergeStrategy, TransferItemInput } from "../types";

// Content Transfer API — create/manage transfer operations and chunk sets.
// Base path per the July 2026 release: {host}/sitecore/api/content/transfer/v1
// Endpoint shapes are new and may still evolve — verify against
// https://api-docs.sitecore.com before going to production.

const BASE_PATH = "/sitecore/api/content/transfer/v1";

interface RequestOptions {
  host: string;
  token: string;
}

async function transferFetch(
  { host, token }: RequestOptions,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${host}${BASE_PATH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  return response;
}

export interface InitiateTransferInput {
  transferId: string;
  items: TransferItemInput[];
  mergeStrategy: MergeStrategy;
  database: string;
}

/** Step 1 — run against the SOURCE environment. */
export async function initiateTransfer(
  options: RequestOptions,
  input: InitiateTransferInput,
): Promise<void> {
  const response = await transferFetch(options, "/transfers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      TransferId: input.transferId,
      Configuration: {
        Database: input.database,
        DataTrees: input.items.map((item) => ({
          ItemPath: item.itemPath,
          Scope: item.scope,
          MergeStrategy: input.mergeStrategy,
        })),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Initiate transfer failed (${response.status}): ${await response.text()}`,
    );
  }
}

export interface ChunkSetInfo {
  chunkSetId: string;
  chunkCount: number;
}

export interface TransferStatus {
  raw: unknown;
  isComplete: boolean;
  isFailed: boolean;
  chunkSets: ChunkSetInfo[];
}

/**
 * Step 2 — poll the SOURCE environment until chunk sets are ready.
 * Known issue (CFW-9663): the status endpoint can return 404 for the first few
 * minutes after initiation — the caller treats 404 as "still pending".
 */
export async function getTransferStatus(
  options: RequestOptions,
  transferId: string,
): Promise<TransferStatus | "not-found"> {
  const response = await transferFetch(
    options,
    `/transfers/${transferId}/status`,
  );
  if (response.status === 404) return "not-found";
  if (!response.ok) {
    throw new Error(
      `Get transfer status failed (${response.status}): ${await response.text()}`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;

  // The response schema is not yet stable across releases; extract the fields
  // we need defensively. Adjust once you have the OpenAPI spec from api-docs.
  const statusText = String(
    raw.Status ?? raw.status ?? raw.State ?? raw.state ?? "",
  ).toLowerCase();
  // The API reports chunk sets as ChunkSetsMetadata (per the SDK typings).
  const rawChunkSets = (raw.ChunkSetsMetadata ??
    raw.chunkSetsMetadata ??
    raw.ChunkSets ??
    raw.chunkSets ??
    []) as Array<Record<string, unknown>>;

  const chunkSets: ChunkSetInfo[] = rawChunkSets.map((cs) => ({
    chunkSetId: String(cs.ChunkSetId ?? cs.chunkSetId ?? cs.Id ?? cs.id),
    chunkCount: Number(cs.ChunkCount ?? cs.chunkCount ?? 0),
  }));

  return {
    raw,
    isComplete:
      statusText.includes("complete") ||
      (chunkSets.length > 0 && chunkSets.every((c) => c.chunkCount > 0)),
    isFailed: statusText.includes("fail") || statusText.includes("error"),
    chunkSets,
  };
}

export interface DownloadedChunk {
  data: ArrayBuffer;
  /** Media chunks are flagged via the Content-Disposition header and must be
   * re-uploaded with ?isMedia=true. */
  isMedia: boolean;
}

/** Step 3 — download a chunk from the SOURCE environment. */
export async function downloadChunk(
  options: RequestOptions,
  transferId: string,
  chunkSetId: string,
  chunkIndex: number,
): Promise<DownloadedChunk> {
  const response = await transferFetch(
    options,
    `/transfers/${transferId}/chunksets/${chunkSetId}/chunks/${chunkIndex}`,
  );
  if (!response.ok) {
    throw new Error(
      `Download chunk ${chunkIndex} failed (${response.status}): ${await response.text()}`,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  return {
    data: await response.arrayBuffer(),
    isMedia: /ismedia\s*=?\s*true/i.test(disposition),
  };
}

/** Step 4 — upload a chunk to the TARGET environment. */
export async function uploadChunk(
  options: RequestOptions,
  transferId: string,
  chunkSetId: string,
  chunkIndex: number,
  chunk: DownloadedChunk,
): Promise<void> {
  const response = await transferFetch(
    options,
    `/transfers/${transferId}/chunksets/${chunkSetId}/chunks/${chunkIndex}?isMedia=${chunk.isMedia}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: chunk.data,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Upload chunk ${chunkIndex} failed (${response.status}): ${await response.text()}`,
    );
  }
}

/** Step 5 — signal the TARGET environment to assemble the .raif file. */
export async function completeChunkSet(
  options: RequestOptions,
  transferId: string,
  chunkSetId: string,
): Promise<void> {
  const response = await transferFetch(
    options,
    `/transfers/${transferId}/chunksets/${chunkSetId}/complete`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(
      `Complete chunk set failed (${response.status}): ${await response.text()}`,
    );
  }
}
