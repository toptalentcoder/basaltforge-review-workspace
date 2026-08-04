import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  createSubmission,
  getMySubmissions,
  getSubmissionById,
} from "@/lib/services/submission-service";
import { approveSubmission, getAllSubmissions, rejectSubmission } from "@/lib/services/review-service";

// These exercise the SERVICE layer, which is where authorization and the
// transactional audit writes are enforced. Every rule is expressed as a typed
// domain error carrying the HTTP status the route layer maps to 1:1, so a
// 403/404/400/409 assertion here is the same guarantee the endpoint gives.
//
// The route handlers are deliberately thin — resolve the session → call the
// service → map the error to a status — and their end-to-end behaviour over
// real HTTP is exercised separately by the curl battery in scratchpad.

/** Run an action and report the status of the domain error it throws (200 if none). */
async function statusOf(action: () => Promise<unknown>): Promise<number> {
  try {
    await action();
    return 200;
  } catch (error) {
    return (error as { status?: number })?.status ?? 500;
  }
}

let alice: User; // USER
let carol: User; // USER (second author, for ownership isolation)
let bob: User; // REVIEWER

/** Create a fresh PENDING submission owned by `author` (submission + SUBMITTED event). */
function pending(author: User, title = "Test document") {
  return createSubmission(author, { title, body: "The body of the document.", category: "Finance" });
}

beforeAll(async () => {
  alice = await prisma.user.create({ data: { email: "alice@test.local", name: "Alice Writer", role: Role.USER } });
  carol = await prisma.user.create({ data: { email: "carol@test.local", name: "Carol Writer", role: Role.USER } });
  bob = await prisma.user.create({ data: { email: "bob@test.local", name: "Bob Reviewer", role: Role.REVIEWER } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("submission creation & ownership", () => {
  it("1. a USER can create a submission — PENDING, with a SUBMITTED audit event", async () => {
    const submission = await createSubmission(alice, {
      title: "Q3 Budget Proposal",
      body: "Requesting approval for the Q3 budget.",
      category: "Finance",
    });

    expect(submission.status).toBe("PENDING");
    expect(submission.authorId).toBe(alice.id);

    const events = await prisma.auditEvent.findMany({ where: { submissionId: submission.id } });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("SUBMITTED");
    expect(events[0].fromStatus).toBeNull();
    expect(events[0].toStatus).toBe("PENDING");
  });

  it("2. a USER sees only their own submissions", async () => {
    const mine = await pending(alice, "Alice-only");
    const hers = await pending(carol, "Carol-only");

    const list = await getMySubmissions(alice);
    const ids = list.map((s) => s.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(hers.id);
    expect(list.every((s) => s.authorId === alice.id)).toBe(true);
  });
});

describe("authorization", () => {
  it("3. a USER calling the reviewer approve endpoint is Forbidden (403)", async () => {
    const doc = await pending(carol);
    expect(await statusOf(() => approveSubmission(alice, doc.id))).toBe(403);

    const after = await prisma.submission.findUnique({ where: { id: doc.id } });
    expect(after?.status).toBe("PENDING"); // rejected before any change
  });

  it("4. a USER accessing another user's submission is Not Found (404)", async () => {
    const doc = await pending(carol);

    expect(await statusOf(() => getSubmissionById(alice, doc.id))).toBe(404); // not the author
    expect(await statusOf(() => getSubmissionById(carol, doc.id))).toBe(200); // the author may read it
    expect(await statusOf(() => getSubmissionById(bob, doc.id))).toBe(200); // a reviewer may read it
  });

  it("5. a REVIEWER can list all submissions (and a USER cannot)", async () => {
    const a = await pending(alice, "Reviewer-list-alice");
    const c = await pending(carol, "Reviewer-list-carol");

    const all = await getAllSubmissions(bob);
    const ids = all.map((s) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(c.id);

    expect(await statusOf(() => getAllSubmissions(alice))).toBe(403);
  });
});

describe("decisions & audit trail", () => {
  it("6. a REVIEWER can approve a pending submission", async () => {
    const doc = await pending(alice);

    const updated = await approveSubmission(bob, doc.id);
    expect(updated.status).toBe("APPROVED");

    const stored = await prisma.submission.findUnique({ where: { id: doc.id } });
    expect(stored?.status).toBe("APPROVED");
  });

  it("7. rejecting without a non-empty reason is a Validation error (400)", async () => {
    const doc = await pending(alice);

    expect(await statusOf(() => rejectSubmission(bob, doc.id, "   "))).toBe(400); // whitespace only
    expect(await statusOf(() => rejectSubmission(bob, doc.id, undefined))).toBe(400); // missing

    const after = await prisma.submission.findUnique({ where: { id: doc.id } });
    expect(after?.status).toBe("PENDING"); // still undecided
  });

  it("8. a second decision on an already-decided submission is a Conflict (409)", async () => {
    const doc = await pending(alice);
    await approveSubmission(bob, doc.id);

    expect(await statusOf(() => rejectSubmission(bob, doc.id, "changed my mind"))).toBe(409);
    expect(await statusOf(() => approveSubmission(bob, doc.id))).toBe(409);
  });

  it("9. a decision updates the submission and writes exactly one matching audit event", async () => {
    const doc = await pending(alice);
    await approveSubmission(bob, doc.id);

    const stored = await prisma.submission.findUnique({ where: { id: doc.id } });
    expect(stored?.status).toBe("APPROVED");

    const events = await prisma.auditEvent.findMany({
      where: { submissionId: doc.id },
      orderBy: { createdAt: "asc" },
    });
    const decisions = events.filter((e) => e.action === "APPROVED" || e.action === "REJECTED");

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("APPROVED");
    expect(decisions[0].fromStatus).toBe("PENDING");
    expect(decisions[0].toStatus).toBe("APPROVED");
    expect(decisions[0].actorId).toBe(bob.id);
    expect(decisions[0].actorRole).toBe("REVIEWER");
  });
});
