import { Role, type Submission, type User } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "./errors";

// Authorization helpers, called at the top of every service entry point.
// Because authorization lives in the service layer — not in routes, pages, or
// middleware — the rules hold identically no matter which transport invoked
// the service (route handler, server component, test, script).
//
// Two deliberate status choices, applied consistently:
// - Role gates throw 403: the caller may know the endpoint exists and that
//   they are not allowed to use it.
// - Ownership misses throw 404 via assertCanAccessSubmission: a user probing
//   other people's submission ids gets the exact same error as for an id that
//   does not exist, so the system never confirms the resource is real.

export function isReviewer(actor: User): boolean {
  return actor.role === Role.REVIEWER;
}

export function requireReviewer(actor: User): void {
  if (!isReviewer(actor)) {
    throw new ForbiddenError("Reviewer role required");
  }
}

/** Object-level access: a submission is visible to its author and to
 *  reviewers. Narrows away null so callers can use the row afterwards. */
export function assertCanAccessSubmission(
  actor: User,
  submission: Pick<Submission, "authorId"> | null,
): asserts submission {
  if (!submission || (!isReviewer(actor) && submission.authorId !== actor.id)) {
    throw new NotFoundError("Submission not found");
  }
}
