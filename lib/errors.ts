// Domain errors thrown by the service layer. Each carries the HTTP status the
// transport layer should map it to, so services stay transport-agnostic and
// the route layer (next phase) does the mapping in exactly one place.
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";

  constructor(message = "Authentication required") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have permission to perform this action") {
    super(message);
  }
}

// Used both for genuinely missing rows and for ownership misses: a normal
// user probing someone else's submission id gets a response indistinguishable
// from "does not exist", so existence is never disclosed.
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(message = "Not found") {
    super(message);
  }
}

// Decision raced or repeated: the submission is no longer PENDING. Carries the
// current status so the UI can say "already approved by someone else".
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "CONFLICT";

  constructor(
    message: string,
    readonly currentStatus?: string,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
