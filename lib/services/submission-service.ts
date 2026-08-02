import { AuditAction, SubmissionStatus, type User } from "@prisma/client";
import { prisma } from "../db";
import { assertCanAccessSubmission } from "../authz";
import { createSubmissionSchema, parseOrThrow } from "../validation";
import { AUDIT_ACTOR_SELECT, AUDIT_EVENT_ORDER, appendEvent } from "./audit-service";

// Services take the acting user explicitly as the first parameter — never
// from ambient context. Every entry point performs its own authorization, so
// the rules hold no matter which transport calls in (route handler, server
// component, seed script, test).

/** Any authenticated user may submit — including reviewers; nothing in the
 *  role model forbids it. Status and author are forced server-side, and the
 *  strict input schema rejects unknown keys, so a payload smuggling `status`
 *  or `authorId` fails validation outright (mass-assignment defense). */
export async function createSubmission(actor: User, input: unknown) {
  const data = parseOrThrow(createSubmissionSchema, input);
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.create({
      data: {
        title: data.title,
        body: data.body,
        category: data.category ?? null,
        authorId: actor.id, // from the session, never from the payload
        // status: PENDING via the schema default — never accepted from input
      },
    });
    // Same transaction: a submission cannot exist without its birth event.
    await appendEvent(tx, {
      submissionId: submission.id,
      actor,
      action: AuditAction.SUBMITTED,
      fromStatus: null,
      toStatus: SubmissionStatus.PENDING,
    });
    return submission;
  });
}

/** Only the actor's own submissions. The scoping lives in the query itself —
 *  there is no "fetch all, filter later" path to get wrong. Bodies are
 *  omitted: list views render title/status/category only, and bodies can be
 *  50KB each. The id tiebreaker keeps same-millisecond rows stably ordered. */
export function getMySubmissions(actor: User) {
  return prisma.submission.findMany({
    where: { authorId: actor.id },
    omit: { body: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/** Detail view: author or reviewer. Includes the author's display identity
 *  and the full audit trail (the detail screen always shows history, and the
 *  rejection reason lives on the REJECTED event — single source of truth).
 *  Non-owners get the same NotFound as a genuinely missing id. */
export async function getSubmissionById(actor: User, id: string) {
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      auditEvents: {
        orderBy: AUDIT_EVENT_ORDER,
        include: { actor: AUDIT_ACTOR_SELECT },
      },
    },
  });
  assertCanAccessSubmission(actor, submission);
  return submission;
}
