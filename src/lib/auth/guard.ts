import { NextResponse } from "next/server";
import { AuthError, verifyOrgAdmin, type VerifiedUser } from "./verify-user";

/**
 * Wraps a route handler behind the Organization Admin/Owner check. AuthErrors
 * (including 400-level validation errors thrown by handlers) become clean
 * JSON responses; anything else propagates as a 500.
 */
export async function withOrgAdmin(
  request: Request,
  handler: (user: VerifiedUser) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await verifyOrgAdmin(request);
    return await handler(user);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
