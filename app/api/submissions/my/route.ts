import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { getMySubmissions } from "@/lib/services/submission-service";

/** GET /api/submissions/my — the caller's own submissions.
 *
 *  Scoping happens in the service's Prisma query (where authorId = actor.id),
 *  not here and not in the client: there is no parameter by which a caller
 *  could ask for someone else's list. Bodies are omitted from list rows. */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  return NextResponse.json({ submissions: await getMySubmissions(user) });
});
