import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requirePageUser } from "@/lib/session";

export default async function ReviewerDashboardPage() {
  const user = await requirePageUser();
  // Navigation guard only. A writer who calls GET /api/reviewer/submissions
  // directly still receives 403 — the redirect is a courtesy, not the control.
  if (user.role !== "REVIEWER") redirect("/submissions/my");

  return (
    <Workspace user={{ id: user.id, name: user.name, email: user.email, role: user.role }} />
  );
}
