import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";

/** GET /api/auth/me — the current session's identity, resolved server-side.
 *  The UI uses this to decide what to render; it is never the source of truth
 *  for permissions, which are enforced per request in the service layer. */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
