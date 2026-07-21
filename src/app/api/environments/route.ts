import { NextResponse } from "next/server";
import { withOrgAdmin } from "@/src/lib/auth/guard";
import { getEnvironments } from "@/src/lib/config";

export async function GET(request: Request) {
  return withOrgAdmin(request, async () =>
    // Names and context ids only — hosts and credentials stay server-side.
    NextResponse.json({
      environments: getEnvironments().map((e) => ({
        name: e.name,
        contextId: e.contextId ?? null,
      })),
    }),
  );
}
