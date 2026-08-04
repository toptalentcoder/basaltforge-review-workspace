import { Workspace } from "@/components/workspace";
import { requirePageUser } from "@/lib/session";

export default async function MySubmissionsPage() {
  // Page-level guard for navigation only; /api/submissions/my scopes the rows
  // to the session's own user regardless of what the client asks for.
  const user = await requirePageUser();
  return (
    <Workspace user={{ id: user.id, name: user.name, email: user.email, role: user.role }} />
  );
}
