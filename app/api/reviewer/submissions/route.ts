import { NextResponse, type NextRequest } from "next/server";
import { handle, readQuery, requireUser } from "@/lib/http";
import { getAllSubmissions, getStatusCounts } from "@/lib/services/review-service";

/** GET /api/reviewer/submissions — reviewer dashboard data. REVIEWER only.
 *
 *  Filters (status, category, search) arrive as query params and are validated
 *  by the same zod schema the service uses; unknown params are rejected with a
 *  400 rather than silently ignored. Rows omit document bodies — the list view
 *  renders title/status/category/author/date only.
 *
 *  Status counts ship alongside the rows so the dashboard can show "what needs
 *  attention" at a glance without a second round trip. Both service calls
 *  enforce the reviewer role independently, so this route cannot leak either
 *  dataset to a normal user (403). */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  const filters = readQuery(req);
  const [submissions, counts] = await Promise.all([
    getAllSubmissions(user, filters),
    getStatusCounts(user),
  ]);
  return NextResponse.json({ submissions, counts });
});
