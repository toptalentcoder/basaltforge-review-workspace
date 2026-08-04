import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { SESSION_COOKIE, resolveSessionUser } from "./auth";

// Server-side session helpers for PAGES (route handlers use lib/http.ts).
// These exist for navigation and rendering only — deciding what to show and
// where to send someone. They are NOT the security boundary: every page's
// data still comes from the API, which re-authenticates and re-authorizes
// each request. Hiding a link never protects an endpoint.

/** The signed-in user for a page render, or null. */
export async function pageUser(): Promise<User | null> {
  const store = await cookies();
  return resolveSessionUser(store.get(SESSION_COOKIE)?.value);
}

/** Require any signed-in user, otherwise send them to the login screen. */
export async function requirePageUser(): Promise<User> {
  const user = await pageUser();
  if (!user) redirect("/login");
  return user;
}

/** Where a user belongs after signing in. */
export function homePathFor(user: User): string {
  return user.role === "REVIEWER" ? "/reviewer/dashboard" : "/submissions/my";
}
