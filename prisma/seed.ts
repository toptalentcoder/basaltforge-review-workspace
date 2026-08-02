import { Role, SubmissionStatus, AuditAction, type User } from "@prisma/client";
import { prisma } from "../lib/db";

// Seed writes go through the same transactional shapes the service layer will
// use in production code: a submission is created together with its SUBMITTED
// audit event, and a decision is a guarded conditional update plus its audit
// event in one transaction. Seeding "through the front door" like this means
// seeded data can never violate the audit invariants the schema enforces —
// a raw INSERT with status APPROVED and no history would be a lie the audit
// trail cannot detect.

/** A timestamp n days ago at a fixed hour, so seeded ordering is stable. */
function daysAgo(n: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Mirrors the future submissions service: submission + SUBMITTED event, one tx. */
async function submit(
  author: User,
  input: { title: string; body: string; category?: string; at: Date },
) {
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.create({
      data: {
        title: input.title,
        body: input.body,
        category: input.category ?? null,
        authorId: author.id,
        createdAt: input.at,
        updatedAt: input.at,
      },
    });
    await tx.auditEvent.create({
      data: {
        submissionId: submission.id,
        actorId: author.id,
        actorRole: author.role,
        action: AuditAction.SUBMITTED,
        fromStatus: null,
        toStatus: SubmissionStatus.PENDING,
        createdAt: input.at,
      },
    });
    return submission;
  });
}

/** Mirrors the future decision service: guarded conditional update + audit
 *  event in one tx. The `status: PENDING` predicate is the race guard — if the
 *  submission was already decided, count is 0 and nothing is written. */
async function decide(
  reviewer: User,
  submissionId: string,
  decision: typeof SubmissionStatus.APPROVED | typeof SubmissionStatus.REJECTED,
  opts: { reason?: string; at: Date },
) {
  await prisma.$transaction(async (tx) => {
    const result = await tx.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.PENDING },
      data: { status: decision, updatedAt: opts.at },
    });
    if (result.count !== 1) {
      throw new Error(`seed: submission ${submissionId} is not PENDING`);
    }
    await tx.auditEvent.create({
      data: {
        submissionId,
        actorId: reviewer.id,
        actorRole: reviewer.role,
        action: decision === SubmissionStatus.APPROVED ? AuditAction.APPROVED : AuditAction.REJECTED,
        fromStatus: SubmissionStatus.PENDING,
        toStatus: decision,
        reason: opts.reason ?? null,
        createdAt: opts.at,
      },
    });
  });
}

async function main() {
  // Dev-only reset so the seed is re-runnable. audit_events is protected by an
  // append-only trigger, so a plain TRUNCATE/DELETE is (correctly) rejected;
  // session_replication_role='replica' suspends ordinary triggers for this
  // transaction only. Requires superuser — true for the local compose user,
  // and exactly the kind of privileged bypass the audit_hardening migration's
  // threat-model comment calls out.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
    prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events, submissions, users`),
  ]);

  const alice = await prisma.user.create({
    data: { email: "alice@company.test", name: "Alice Nguyen", role: Role.USER, createdAt: daysAgo(30) },
  });
  const bob = await prisma.user.create({
    data: { email: "bob@company.test", name: "Bob Okafor", role: Role.REVIEWER, createdAt: daysAgo(30) },
  });

  // 1. Pending — what the reviewer dashboard should surface first.
  await submit(alice, {
    title: "Q3 Budget Proposal",
    category: "Finance",
    at: daysAgo(1),
    body: [
      "Requesting approval for the Q3 departmental budget.",
      "",
      "Headcount: +2 engineers (backfill for attrition in June).",
      "Infrastructure: $14,500/quarter, up 8% due to the new staging environment.",
      "Travel & training: flat vs Q2.",
      "",
      "Full line-item breakdown is maintained in the finance workbook; this",
      "submission covers the summary figures that require workspace approval.",
    ].join("\n"),
  });

  // 2. Approved — submitted 5 days ago, approved by Bob a day later.
  const policy = await submit(alice, {
    title: "Security Policy Update",
    category: "Policy",
    at: daysAgo(5),
    body: [
      "Proposed update to the remote-access security policy.",
      "",
      "Changes: (1) mandatory hardware keys for VPN access, replacing TOTP;",
      "(2) session timeout reduced from 12h to 8h; (3) quarterly access reviews",
      "for contractors formalized as a checklist item.",
      "",
      "Rollout: 30-day grace period with both factors accepted, then hard cutover.",
    ].join("\n"),
  });
  await decide(bob, policy.id, SubmissionStatus.APPROVED, { at: daysAgo(4, 14) });

  // 3. Rejected — submitted 7 days ago, rejected by Bob with a required reason.
  const vendor = await submit(alice, {
    title: "Vendor Contract Request",
    category: "Procurement",
    at: daysAgo(7),
    body: [
      "Requesting approval to engage DataViz Pro Ltd. for dashboard tooling.",
      "",
      "Term: 12 months, $2,100/month, auto-renewal clause struck.",
      "Data shared: aggregated usage metrics only, no customer PII.",
      "",
      "Vendor security questionnaire: pending (chasing their compliance team).",
    ].join("\n"),
  });
  await decide(bob, vendor.id, SubmissionStatus.REJECTED, {
    at: daysAgo(6, 11),
    reason:
      "Vendor has not completed the security questionnaire. Please attach the completed assessment and resubmit — procurement cannot review the data-sharing terms without it.",
  });

  const users = await prisma.user.count();
  const submissions = await prisma.submission.count();
  const events = await prisma.auditEvent.count();
  console.log(`Seeded ${users} users, ${submissions} submissions, ${events} audit events.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
