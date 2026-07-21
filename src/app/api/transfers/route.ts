import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { getEnvironments } from "@/src/lib/config";
import { validateTransferRequest } from "@/src/lib/validate-transfer";
import { runTransfer } from "@/src/lib/sitecore/orchestrator";
import { listJobs, saveJob } from "@/src/lib/sitecore/job-store";
import type { TransferJob, TransferJobSummary } from "@/src/lib/types";

// Let the function keep running after the response so the transfer pipeline
// can complete (Vercel Fluid Compute allows up to 300s on Hobby, 800s on Pro).
export const maxDuration = 300;

export async function POST(request: Request) {
  return withOrgAdmin(request, async (user) => {
    const transferRequest = validateTransferRequest(
      await request.json(),
      getEnvironments().map((e) => e.name),
    );

    const now = new Date().toISOString();
    const job: TransferJob = {
      id: randomUUID(),
      transferId: randomUUID(),
      status: "pending",
      request: transferRequest,
      requestedBy: user.sub,
      log: [],
      createdAt: now,
      updatedAt: now,
    };
    saveJob(job);

    // Stream progress as newline-delimited JSON over this same response. The
    // whole pipeline runs inside this one invocation, so it works on
    // serverless hosts where separate instances share no memory — and the
    // open stream keeps the function alive until the transfer finishes.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        send({ type: "created", id: job.id });
        runTransfer(job, (message) => send({ type: "log", message }))
          .catch((err) => {
            job.status = "failed";
            job.error = err instanceof Error ? err.message : String(err);
          })
          .finally(() => {
            send({
              type: "done",
              status: job.status,
              error: job.error ?? null,
            });
            controller.close();
          });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  });
}

export async function GET(request: Request) {
  return withOrgAdmin(request, async () => {
    const jobs: TransferJobSummary[] = listJobs().map((j) => ({
      id: j.id,
      status: j.status,
      itemPaths: j.request.items.map((item) => item.itemPath),
      sourceEnvironment: j.request.sourceEnvironment,
      targetEnvironment: j.request.targetEnvironment,
      requestedBy: j.requestedBy,
      createdAt: j.createdAt,
    }));
    return NextResponse.json({ jobs });
  });
}
