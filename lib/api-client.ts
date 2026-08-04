// Browser-side API client. Every screen talks to the same REST endpoints an
// external client would call, so the UI gets no privileged path to the data.

export type Role = "USER" | "REVIEWER";
export type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type AuditAction = "SUBMITTED" | "APPROVED" | "REJECTED";

export type SessionUser = { id: string; name: string; email: string; role: Role };

/** List rows omit the document body — the API does not send it for lists. */
export type SubmissionRow = {
  id: string;
  title: string;
  category: string | null;
  status: SubmissionStatus;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; name: string };
};

export type AuditEventView = {
  id: string;
  action: AuditAction;
  fromStatus: SubmissionStatus | null;
  toStatus: SubmissionStatus;
  reason: string | null;
  actorRole: Role;
  createdAt: string;
  actor: { id: string; name: string };
};

export type SubmissionDetail = SubmissionRow & {
  body: string;
  author: { id: string; name: string };
  auditEvents: AuditEventView[];
};

export type StatusCounts = Record<SubmissionStatus, number>;

/** A non-2xx response, carrying what the UI needs to react intelligently:
 *  the status code, the server's message, and (on 409) the status the
 *  submission is actually in now. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly currentStatus?: SubmissionStatus,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    // Network-level failure: the server is down or unreachable.
    throw new ApiError(0, "Could not reach the server. Check that it is running and try again.");
  }

  const payload = (await res.json().catch(() => null)) as
    | { error?: string; message?: string; currentStatus?: SubmissionStatus }
    | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.message ?? payload?.error ?? `Request failed (${res.status})`,
      payload?.currentStatus,
    );
  }
  return payload as T;
}

export const api = {
  login: (email: string) =>
    apiFetch<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  logout: () => apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  createSubmission: (input: { title: string; body: string; category?: string }) =>
    apiFetch<{ submission: SubmissionRow }>("/api/submissions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  mySubmissions: () => apiFetch<{ submissions: SubmissionRow[] }>("/api/submissions/my"),

  submission: (id: string) =>
    apiFetch<{ submission: SubmissionDetail }>(`/api/submissions/${encodeURIComponent(id)}`),

  auditHistory: (id: string) =>
    apiFetch<{ events: AuditEventView[] }>(`/api/submissions/${encodeURIComponent(id)}/audit`),

  reviewerSubmissions: (filters: { status?: string; category?: string; search?: string }) => {
    const params = new URLSearchParams();
    // Blank values are omitted: the API treats "?status=" as no filter, but
    // sending nothing at all keeps the URL and the request honest.
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return apiFetch<{ submissions: SubmissionRow[]; counts: StatusCounts }>(
      `/api/reviewer/submissions${query ? `?${query}` : ""}`,
    );
  },

  approve: (id: string) =>
    apiFetch<{ submission: SubmissionRow }>(
      `/api/submissions/${encodeURIComponent(id)}/approve`,
      { method: "POST" },
    ),

  reject: (id: string, reason: string) =>
    apiFetch<{ submission: SubmissionRow }>(`/api/submissions/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};

/** Dates arrive as ISO strings; render them consistently everywhere. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
