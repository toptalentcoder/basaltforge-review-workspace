import { NextResponse, type NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/http";
import { createSubmission } from "@/lib/services/submission-service";

/** POST /api/submissions — submit a document for review.
 *
 *  Any authenticated user may submit. Client-supplied authorId, status, or
 *  createdAt are not "ignored" so much as rejected outright: the service's
 *  strict zod schema fails on unknown keys (400), and author/status are set
 *  server-side from the session and the schema default. The service creates
 *  the submission and its SUBMITTED audit event in one transaction. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  const submission = await createSubmission(user, await readJson(req));
  return NextResponse.json({ submission }, { status: 201 });
});
