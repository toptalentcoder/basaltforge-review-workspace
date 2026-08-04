import { Workspace } from "@/components/workspace";
import { requirePageUser } from "@/lib/session";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

  // The workspace opens with this document selected. Whether the viewer may
  // actually read it is decided by the API: the detail endpoint returns 404
  // for anyone who is neither its author nor a reviewer.
  return (
    <Workspace
      user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
      initialSelectedId={id}
    />
  );
}
