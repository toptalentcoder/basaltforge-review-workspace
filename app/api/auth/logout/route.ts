import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { handle } from "@/lib/http";

/** POST /api/auth/logout — clear the session cookie. */
export const POST = handle(async () => {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
});
