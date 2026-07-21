// Item Transfer API — consume assembled .raif packages into the target
// environment. Base path per the July 2026 release:
// {host}/sitecore/shell/api/v3/ItemsTransfer
// Verify endpoint shapes against https://api-docs.sitecore.com.

const BASE_PATH = "/sitecore/shell/api/v3/ItemsTransfer";

interface RequestOptions {
  host: string;
  token: string;
}

export function blobNameFor(transferId: string, chunkSetId: string): string {
  return `contentTransfer-${transferId}-${chunkSetId}.raif`;
}

/** Step 6 — consume the .raif blob into the target database. */
export async function consumeBlob(
  { host, token }: RequestOptions,
  database: string,
  blobName: string,
): Promise<void> {
  const response = await fetch(
    `${host}${BASE_PATH}/transfers/databases/${database}/sources?blobName=${encodeURIComponent(blobName)}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Consume blob failed (${response.status}): ${await response.text()}`,
    );
  }
}

export interface BlobStatus {
  raw: unknown;
  isTransferred: boolean;
}

/** Step 7 — verify the blob was consumed (BlobState: "Transferred"). */
export async function getBlobStatus(
  { host, token }: RequestOptions,
  blobName: string,
): Promise<BlobStatus> {
  const response = await fetch(
    `${host}${BASE_PATH}/sources/blobs/${encodeURIComponent(blobName)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Get blob status failed (${response.status}): ${await response.text()}`,
    );
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const state = String(raw.BlobState ?? raw.blobState ?? raw.State ?? "");
  return { raw, isTransferred: state.toLowerCase() === "transferred" };
}
