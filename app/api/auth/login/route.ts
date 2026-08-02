import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, login } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { parseOrThrow } from "@/lib/validation";

const loginSchema = z.strictObject({
  email: z.string().trim().min(1, "Email is required").max(200),
});

/** POST /api/auth/login — mock sign-in as a seeded user.
 *
 *  No password by design (see lib/auth.ts). The response sets an httpOnly,
 *  SameSite=Lax session cookie whose value is signed server-side, so a client
 *  can neither read a useful credential out of it nor forge one for another
 *  user — and crucially cannot claim a role: the role is always loaded from
 *  the database on subsequent requests. */
export const POST = handle(async (req: NextRequest) => {
  const { email } = parseOrThrow(loginSchema, await readJson(req));
  const { user, sessionValue } = await login(email);

  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // Bounds the browser's copy. Note the signed value itself carries no
    // expiry, so logout clears the cookie but cannot revoke a value captured
    // beforehand — a limitation of the mocked identity step, noted in the
    // README alongside what a real session store would add.
    maxAge: 60 * 60 * 8,
  });
  return response;
});
