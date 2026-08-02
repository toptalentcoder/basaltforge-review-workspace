import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { getSubmissionById } from "@/lib/services/submission-service";

/** GET /api/submissions/:id — full detail plus audit history.
 *
 *  The service enforces object-level access: authors see their own, reviewers
 *  see any, and everyone else gets a 404 identical to a genuinely missing id
 *  so the endpoint never confirms that another user's submission exists.
 *  History ships with the detail because the decision screen must show it. */
export const GET = handle(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const submission = await getSubmissionById(user, id);
    return NextResponse.json({ submission });
  },
);
