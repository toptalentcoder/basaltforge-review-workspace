import { NextResponse, type NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/http";
import { rejectSubmission } from "@/lib/services/review-service";

/** POST /api/submissions/:id/reject — REVIEWER only. Body: { reason }.
 *
 *  The reason is required and must be non-empty after trimming; the service
 *  validates it (400) and stores it on the immutable audit event, which is
 *  the single source of truth for why something was rejected.
 *
 *  Note the ordering the service guarantees: the role gate runs BEFORE reason
 *  validation, so a normal user calling this gets 403 — never a 400 hinting
 *  at the payload shape of an endpoint they may not use. A parse failure is
 *  deliberately swallowed to null rather than thrown here, so that ordering
 *  survives: an unparseable body must not turn a would-be 403 into a 400.
 *  (readJson still enforces the size cap before the body is buffered.) */
export const POST = handle(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const body = (await readJson(req).catch(() => null)) as { reason?: unknown } | null;
    return NextResponse.json({ submission: await rejectSubmission(user, id, body?.reason) });
  },
);
