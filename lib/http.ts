import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { SESSION_COOKIE, requireSessionUser } from "./auth";
import { AppError, ConflictError, ForbiddenError, ValidationError } from "./errors";

// Transport adapter. This is the ONLY place that knows about HTTP: it turns a
// request into an authenticated actor, bounds what a request may cost, and
// maps domain errors to status codes. Route handlers stay thin; services stay
// transport-free.

/** Canonical error text per status, exactly as the API contract specifies. */
const ERROR_LABEL: Record<number, string> = {
  400: "Validation Error",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  500: "Internal Server Error",
};

/** Ceiling on request bodies. The largest legitimate payload is a 50,000-char
 *  document body, so 256 KB is generous; the point is that it is bounded. */
const MAX_BODY_BYTES = 256 * 1024;

const NUL = "\u0000";

/** Resolve the acting user from the signed session cookie, or throw 401.
 *
 *  The cookie is read off the passed request rather than via next/headers'
 *  cookies(), so handlers remain plain (req) => Response functions that tests
 *  can invoke directly without booting a server or a Next request context.
 *  The role is never read from the request — auth.ts loads it from the DB. */
export function requireUser(req: NextRequest): Promise<User> {
  return requireSessionUser(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Read and parse a JSON body under a hard size cap.
 *
 *  App Router route handlers have no built-in body limit (the Pages Router's
 *  bodyParser.sizeLimit does not apply, and serverActions.bodySizeLimit covers
 *  only Server Actions), so an unbounded req.json() would buffer whatever a
 *  client sends before validation ever runs — an unauthenticated memory-
 *  exhaustion vector via the login route. The body is therefore streamed with
 *  a running byte count and abandoned the moment it exceeds the cap. */
export async function readJson(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ValidationError("Request body is too large");
  }

  let text: string;
  if (req.body) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ValidationError("Request body is too large");
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    // Fallback for requests that expose no readable stream; the
    // Content-Length gate above still bounds what can arrive here.
    text = await req.text();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }

  // JSON.parse creates "__proto__" as an own property (no pollution occurs),
  // but the strict schemas ignore it — so reject it explicitly rather than
  // let one key quietly escape the "unknown keys are rejected" rule.
  if (parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, "__proto__")) {
    throw new ValidationError('Unrecognized key: "__proto__"');
  }
  assertNoNulBytes(parsed);
  return parsed;
}

/** Reject NUL characters anywhere in the decoded payload.
 *
 *  Scanning the raw bytes is not enough: JSON encodes NUL as the escape
 *  sequence \u0000, which passes a byte scan and only materializes after
 *  parsing — then fails at Postgres, which refuses NUL in text columns
 *  (SQLSTATE 22021), turning invalid input into an opaque 500. */
function assertNoNulBytes(value: unknown): void {
  if (typeof value === "string") {
    if (value.includes(NUL)) {
      throw new ValidationError("Input must not contain null bytes");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoNulBytes(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertNoNulBytes(item);
  }
}

/** Validate query parameters before they become a filter object: reject
 *  repeats (which URLSearchParams would otherwise silently collapse to the
 *  last value, making validation order-dependent), NUL bytes, and __proto__.
 *  Blank values are dropped so "?status=" means "no filter" rather than
 *  failing enum validation — the UI's "All" option sends exactly that. */
export function readQuery(req: NextRequest): Record<string, string> {
  // Defense in depth: Next currently strips a "__proto__" query key before a
  // handler ever sees it (it appears in neither req.url nor searchParams), so
  // this guard cannot fire today — it exists so the strictness rule still
  // holds if that behavior changes. The equivalent key IS observable in a
  // JSON body, and readJson rejects it there.
  if (/[?&]__proto__=/.test(req.url)) {
    throw new ValidationError('Unrecognized key: "__proto__"');
  }
  const params = req.nextUrl.searchParams;
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) {
      throw new ValidationError(`${key}: repeated query parameter`);
    }
  }
  for (const value of params.values()) {
    if (value.includes(NUL)) {
      throw new ValidationError("Query parameters must not contain null bytes");
    }
  }
  return Object.fromEntries([...params].filter(([, value]) => value !== ""));
}

/** Reject cross-origin mutations.
 *
 *  SameSite=Lax already blocks classic cross-site form CSRF, but "same site"
 *  is computed on scheme + registrable domain and ignores the port — so any
 *  other page served from localhost (another dev server, a local docs site)
 *  counts as same-site and could drive authenticated approvals. Comparing
 *  Origin to Host closes that. Requests without an Origin header (curl, the
 *  test suite, server-to-server) are allowed: no browser is attaching
 *  ambient credentials, so there is no CSRF to prevent. */
function assertSameOrigin(req: NextRequest): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Cross-origin request rejected");
  }
  if (originHost !== req.headers.get("host")) {
    throw new ForbiddenError("Cross-origin request rejected");
  }
}

/** Every response carries per-user data, so mark it uncacheable and keyed by
 *  session. Next makes route handlers dynamic on the origin but does not add
 *  Cache-Control to them (unlike dynamic pages); without this, a shared proxy
 *  or CDN could serve one user's response to another, bypassing authorization
 *  entirely — and a browser would retain authenticated JSON after logout. */
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  const vary = res.headers.get("Vary");
  res.headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
  return res;
}

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return noStore(
    NextResponse.json({ error: ERROR_LABEL[status] ?? "Error", message, ...extra }, { status }),
  );
}

/** Wrap a route handler: enforce the cross-origin rule, apply cache headers,
 *  and map any domain error to its status in exactly one place. Unknown
 *  errors become an opaque 500 — internals are logged server-side, never
 *  returned to the caller. */
export function handle<Args extends unknown[]>(
  fn: (req: NextRequest, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ...args: Args): Promise<NextResponse> => {
    try {
      assertSameOrigin(req);
      return noStore(await fn(req, ...args));
    } catch (error) {
      if (error instanceof AppError) {
        return errorResponse(
          error.status,
          error.message,
          error instanceof ConflictError && error.currentStatus
            ? { currentStatus: error.currentStatus }
            : undefined,
        );
      }
      console.error("Unhandled error in route handler:", error);
      return errorResponse(500, "An unexpected error occurred");
    }
  };
}
