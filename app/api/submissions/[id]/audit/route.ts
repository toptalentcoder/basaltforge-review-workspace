import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { getAuditHistory } from "@/lib/services/audit-service";

/** GET /api/submissions/:id/audit — the audit trail on its own.
 *
 *  The brief requires history to be "viewable separately from the current
 *  state of a submission", so it has its own endpoint rather than existing
 *  only as a field on the detail response. Same access rule as the detail
 *  route: author or reviewer, otherwise 404. */
export const GET = handle(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    return NextResponse.json({ events: await getAuditHistory(user, id) });
  },
);
