import { redirect } from "next/navigation";
import { homePathFor, pageUser } from "@/lib/session";

/** Send each visitor to the screen that matches their role. */
export default async function Home() {
  const user = await pageUser();
  redirect(user ? homePathFor(user) : "/login");
}
