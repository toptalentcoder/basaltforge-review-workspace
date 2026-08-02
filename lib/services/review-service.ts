import { AuditAction, SubmissionStatus, type Prisma, type User } from "@prisma/client";
import { prisma } from "../db";
import { requireReviewer } from "../authz";
import { ConflictError, NotFoundError } from "../errors";
import { listFiltersSchema, parseOrThrow, rejectReasonSchema } from "../validation";
import { appendEvent } from "./audit-service";

/** Reviewer-only list of all submissions, with the dashboard's filters.
 *  PENDING lists come oldest-first (queue semantics: what has waited longest
 *  needs attention first); otherwise newest-first. */
export async function getAllSubmissions(actor: User, rawFilters: unknown = {}) {
  requireReviewer(actor);
  const filters = parseOrThrow(listFiltersSchema, rawFilters);
  const where: Prisma.SubmissionWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.search
      ? { title: { contains: filters.search, mode: "insensitive" } }
      : {}),
  };
  const direction = filters.status === SubmissionStatus.PENDING ? ("asc" as const) : ("desc" as const);
  return prisma.submission.findMany({
    where,
    // Bodies are omitted: the dashboard renders title/status/category/author
    // only, and bodies can be 50KB each. The id tiebreaker keeps
    // same-millisecond rows stably ordered.
    omit: { body: true },
    include: { author: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: direction }, { id: direction }],
    // Hard server-side cap — pagination is a deliberate non-goal at seed
    // scale (a "with more time" item, noted in the README).
    take: 100,
  });
}

/** Status counts for the dashboard's at-a-glance strip. */
export async function getStatusCounts(actor: User): Promise<Record<SubmissionStatus, number>> {
  requireReviewer(actor);
  const groups = await prisma.submission.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<SubmissionStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

export async function approveSubmission(actor: User, submissionId: string) {
  requireReviewer(actor);
  return decide(actor, submissionId, SubmissionStatus.APPROVED, null);
}

export async function rejectSubmission(actor: User, submissionId: string, reason: unknown) {
  // Authorization before validation: a USER calling this must get 403, not a
  // 400 about the reason field.
  requireReviewer(actor);
  return decide(actor, submissionId, SubmissionStatus.REJECTED, parseOrThrow(rejectReasonSchema, reason));
}

/** The decision write path — the core of the whole exercise.
 *
 *  One transaction containing:
 *  1. A conditional update whose WHERE clause is both the state machine and
 *     the race guard: only a PENDING submission can be decided. Two reviewers
 *     deciding simultaneously → the second blocks on the row lock, re-checks
 *     the predicate after the first commits, matches 0 rows, and gets a 409.
 *     (Relies on READ COMMITTED semantics — do not pass an isolationLevel
 *     override to this $transaction.)
 *  2. The audit event, in the same transaction, so state and history commit
 *     or roll back together.
 *
 *  The DB backstops both halves independently: an illegal status flip is
 *  rejected by the submissions transition trigger, and a second decision
 *  event violates a partial unique index (audit_hardening migration). */
async function decide(
  actor: User,
  submissionId: string,
  decision: typeof SubmissionStatus.APPROVED | typeof SubmissionStatus.REJECTED,
  reason: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.PENDING },
      data: { status: decision },
    });

    if (updated.count === 0) {
      // Distinguish "doesn't exist" (404) from "already decided" (409, with
      // the current status so the UI can explain what happened).
      const current = await tx.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
      });
      if (!current) throw new NotFoundError("Submission not found");
      throw new ConflictError(
        `Submission has already been ${current.status.toLowerCase()}`,
        current.status,
      );
    }

    await appendEvent(tx, {
      submissionId,
      actor,
      action: decision === SubmissionStatus.APPROVED ? AuditAction.APPROVED : AuditAction.REJECTED,
      fromStatus: SubmissionStatus.PENDING,
      toStatus: decision,
      reason,
    });

    return tx.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { author: { select: { id: true, name: true } } },
    });
  });
}
