import type { TransferJob } from "../types";

// In-memory job store. Survives Next.js dev-server HMR via globalThis, but is
// per-instance and lost on restart/redeploy — swap for Redis/a database if you
// run more than one instance or need durable transfer history.

const globalStore = globalThis as unknown as {
  __transferJobs?: Map<string, TransferJob>;
};

const jobs = (globalStore.__transferJobs ??= new Map<string, TransferJob>());

export function saveJob(job: TransferJob): void {
  job.updatedAt = new Date().toISOString();
  jobs.set(job.id, job);
}

export function getJob(id: string): TransferJob | undefined {
  return jobs.get(id);
}

export function listJobs(): TransferJob[] {
  return [...jobs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function appendLog(job: TransferJob, message: string): void {
  job.log.push({ time: new Date().toISOString(), message });
  saveJob(job);
}
