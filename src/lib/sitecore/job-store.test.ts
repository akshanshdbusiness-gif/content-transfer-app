import { describe, expect, it } from "vitest";
import { appendLog, getJob, listJobs, saveJob } from "./job-store";
import type { TransferJob } from "../types";

function makeJob(id: string, createdAt: string): TransferJob {
  return {
    id,
    transferId: `transfer-${id}`,
    status: "pending",
    request: {
      items: [{ itemPath: "/sitecore/content/x", scope: "SingleItem" }],
      mergeStrategy: "KeepExistingItem",
      database: "master",
      sourceEnvironment: "dev",
      targetEnvironment: "qa",
    },
    requestedBy: "auth0|tester",
    log: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("job store", () => {
  it("stores and retrieves jobs by id", () => {
    const job = makeJob("job-1", "2026-07-01T00:00:00.000Z");
    saveJob(job);
    expect(getJob("job-1")?.transferId).toBe("transfer-job-1");
    expect(getJob("missing")).toBeUndefined();
  });

  it("lists jobs newest first", () => {
    saveJob(makeJob("older", "2026-07-01T00:00:00.000Z"));
    saveJob(makeJob("newer", "2026-07-02T00:00:00.000Z"));
    const ids = listJobs().map((j) => j.id);
    expect(ids.indexOf("newer")).toBeLessThan(ids.indexOf("older"));
  });

  it("appendLog records entries and bumps updatedAt", () => {
    const job = makeJob("logged", "2026-07-01T00:00:00.000Z");
    saveJob(job);
    appendLog(job, "first");
    appendLog(job, "second");
    const stored = getJob("logged")!;
    expect(stored.log.map((l) => l.message)).toEqual(["first", "second"]);
    expect(stored.updatedAt >= stored.createdAt).toBe(true);
  });
});
