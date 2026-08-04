import { Workspace } from "@/components/workspace";
import { requirePageUser } from "@/lib/session";

export default async function NewSubmissionPage() {
  const user = await requirePageUser();
  return (
    <Workspace
      user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
      initialComposing
    />
  );
}
