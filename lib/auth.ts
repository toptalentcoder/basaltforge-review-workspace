import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { UnauthorizedError } from "./errors";

// ── Mock authentication: mocked identity, real authorization ────────────────
//
// The exercise explicitly allows a mocked login. What is mocked here is the
// IDENTITY step only: there are no passwords, and anyone can log in as any
// seeded user from the login screen. What is NOT mocked is authorization:
// on every request the user — including their role — is re-loaded from the
// database, never read from anything the client controls.
//
// The session cookie value is `<userId>.<hmac>` — signed with a server-side
// secret. The signature matters even in a mock: user ids necessarily appear
// in API responses (authors, audit actors), so a bare-id session value would
// make every visible id a forgeable credential — including a USER forging a
// REVIEWER session from an id seen in their own audit trail. With the HMAC,
// knowing an id is worthless without the server secret; escalating USER to
// REVIEWER via the API is impossible. (Impersonation remains possible via the
// passwordless login screen itself — that is the mock, and the README owns it.)
//
// Deliberately absent, and why:
// - passwords / OAuth: nothing secret to protect in a seeded demo, and every
//   credential adds setup friction for the reviewer running this.
// - JWT: a token whose payload the server trusts would put the role claim in
//   the client's hands — strictly worse for this exercise's core requirement
//   than a server-side lookup per request.
// - a session store: the signed user id already gives logout-free mock
//   sessions; a session table would add state for no security gain here.
//
// This module is transport-agnostic on purpose: route handlers read the
// cookie off their NextRequest, server components read it via cookies(), and
// both hand the raw value to the functions below. (Keeping next/headers out
// of this file also keeps it directly invocable from tests and scripts.)

export const SESSION_COOKIE = "workspace_session";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set (it ships in the committed .env)");
  }
  return secret;
}

function sign(userId: string): string {
  return createHmac("sha256", sessionSecret()).update(userId).digest("base64url");
}

/** userId + HMAC. cuids and base64url contain no ".", so the last "." splits. */
function createSessionValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

function verifySessionValue(value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return userId;
}

/** Login: validate a seeded user by email and return the value the transport
 *  layer should set as the session cookie. No password — see module comment. */
export async function login(email: string): Promise<{ user: User; sessionValue: string }> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) throw new UnauthorizedError("Unknown user email");
  return { user, sessionValue: createSessionValue(user.id) };
}

/** Resolve the current user from the session cookie value: verify the
 *  signature, then load the user — and therefore the role — from the DB.
 *  Returns null for missing, unsigned, or tampered sessions so transports can
 *  choose between a redirect and a 401. */
export async function resolveSessionUser(
  sessionValue: string | null | undefined,
): Promise<User | null> {
  if (!sessionValue) return null;
  const userId = verifySessionValue(sessionValue);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/** Like resolveSessionUser, but throws 401 — for contexts that require auth. */
export async function requireSessionUser(
  sessionValue: string | null | undefined,
): Promise<User> {
  const user = await resolveSessionUser(sessionValue);
  if (!user) throw new UnauthorizedError();
  return user;
}
