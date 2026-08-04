import { redirect } from "next/navigation";
import { homePathFor, pageUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await pageUser();
  if (user) redirect(homePathFor(user));
  return <LoginForm />;
}
