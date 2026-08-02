import type { AuditAction, Prisma, SubmissionStatus, User } from "@prisma/client";
import { prisma } from "../db";
import { assertCanAccessSubmission } from "../authz";

// The audit trail is append-only. This module exposes exactly two operations:
// append (transaction-scoped) and read. There is deliberately no update or
// delete — and if one were ever added by mistake, the database triggers from
// the audit_hardening migration would reject it at runtime anyway.

// Every reader of the timeline uses the same ordering and actor projection —
// exported so getSubmissionById's embedded include cannot drift from
// getAuditHistory. The id tiebreaker matters because events created in one
// transaction share a timestamp.
export const AUDIT_EVENT_ORDER = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.AuditEventOrderByWithRelationInput[];
export const AUDIT_ACTOR_SELECT = { select: { id: true, name: true } } as const;

/** Append an audit event INSIDE the caller's transaction.
 *
 *  Taking a transaction client as the first argument — with a runtime guard
 *  rejecting the global client, which is structurally assignable — makes the
 *  core invariant hold: an audit event cannot be written except as part of
 *  the same transaction as the state change it records. If the state change
 *  rolls back, so does the event; the trail cannot diverge from the state it
 *  describes. */
export function appendEvent(
  tx: Prisma.TransactionClient,
  event: {
    submissionId: string;
    actor: User;
    action: AuditAction;
    fromStatus: SubmissionStatus | null;
    toStatus: SubmissionStatus;
    reason?: string | null;
  },
) {
  if ("$transaction" in tx) {
    throw new Error("appendEvent must be called with a transaction client, not the global client");
  }
  return tx.auditEvent.create({
    data: {
      submissionId: event.submissionId,
      actorId: event.actor.id,
      // Snapshot, not just a FK: proves what the actor was authorized as at
      // the moment they acted, even if their role changes later.
      actorRole: event.actor.role,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason ?? null,
      // createdAt: server clock via the schema default — never client input.
    },
  });
}

/** Per-submission history, oldest first. Visible to the submission's author
 *  and to reviewers — authors must be able to read rejection reasons. The
 *  ownership check reuses the 404-not-403 rule: non-owners cannot learn the
 *  submission exists. */
export async function getAuditHistory(actor: User, submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { authorId: true },
  });
  assertCanAccessSubmission(actor, submission);
  return prisma.auditEvent.findMany({
    where: { submissionId },
    orderBy: AUDIT_EVENT_ORDER,
    include: { actor: AUDIT_ACTOR_SELECT },
  });
}
