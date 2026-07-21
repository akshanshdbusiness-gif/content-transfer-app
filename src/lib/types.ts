// Shared types between the frontend form and the backend transfer pipeline.

export const TRANSFER_SCOPES = ["SingleItem", "ItemAndDescendants"] as const;
export type TransferScope = (typeof TRANSFER_SCOPES)[number];

export const MERGE_STRATEGIES = [
  "OverrideExistingItem",
  "KeepExistingItem",
  "LatestWin",
  "OverrideExistingTree",
] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/** One entry in the transfer — Package Designer style: a path, with or
 * without its children. */
export interface TransferItemInput {
  itemPath: string;
  scope: TransferScope;
}

export interface TransferRequest {
  items: TransferItemInput[];
  /** Applied to every item in the batch. */
  mergeStrategy: MergeStrategy;
  database: string;
  sourceEnvironment: string;
  targetEnvironment: string;
}

/** Dropdown option — value is an environment name (backend mode) or a
 * sitecoreContextId (sdk mode). */
export interface EnvironmentOption {
  value: string;
  label: string;
  /** sitecoreContextId used for Authoring GraphQL calls via the SDK. */
  contextId?: string;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobLogEntry {
  time: string;
  message: string;
}

export interface TransferJob {
  id: string;
  transferId: string;
  status: JobStatus;
  request: TransferRequest;
  /** Portal user (sub claim) who started the transfer — our own audit trail. */
  requestedBy: string;
  log: JobLogEntry[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransferJobSummary {
  id: string;
  status: JobStatus;
  itemPaths: string[];
  sourceEnvironment: string;
  targetEnvironment: string;
  requestedBy: string;
  createdAt: string;
}
