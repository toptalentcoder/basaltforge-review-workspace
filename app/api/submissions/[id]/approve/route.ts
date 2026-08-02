import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { approveSubmission } from "@/lib/services/review-service";

/** POST /api/submissions/:id/approve — REVIEWER only.
 *
 *  All rules live in the service: role gate (403), submission must exist
 *  (404) and still be PENDING (409, carrying the current status so the UI can
 *  explain what happened), and the status change plus its audit event commit
 *  in a single transaction. No request body is read — approving carries no
 *  client-supplied data, so there is nothing to validate or trust. */
export const POST = handle(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    return NextResponse.json({ submission: await approveSubmission(user, id) });
  },
);
