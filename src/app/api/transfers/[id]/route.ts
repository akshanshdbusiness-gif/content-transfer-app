import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { getJob } from "@/src/lib/sitecore/job-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgAdmin(request, async () => {
    const { id } = await params;
    const job = getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job });
  });
}
