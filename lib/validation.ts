import { z } from "zod";
import { ValidationError } from "./errors";

// Input schemas for the service layer, reused verbatim by the API routes in
// the next phase (one definition, enforced at both altitudes).
//
// strictObject rejects unknown keys: a payload smuggling `status: "APPROVED"`
// or `authorId: <someone else>` fails validation outright — mass assignment
// is killed structurally, not by field-mapping luck. String limits mirror the
// DB column caps (varchar 200/50), so an over-length value surfaces as a 400
// validation message instead of a raw database error.

// Optional text fields: real transports send "" (blank form field) or null
// for "not provided", so blank normalizes to absent instead of failing with a
// confusing 400 on an optional field.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));

export const createSubmissionSchema = z.strictObject({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  body: z.string().trim().min(1, "Body is required").max(50_000, "Body is too long"),
  category: optionalText(50),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

// Literal values rather than a Prisma import keeps this schema usable from
// client components later; the DB enum remains the source of truth and the
// values are pinned by the service-layer types.
export const submissionStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const listFiltersSchema = z.strictObject({
  status: submissionStatusSchema.optional(),
  category: optionalText(50),
  search: optionalText(200),
});

export type ListFilters = z.infer<typeof listFiltersSchema>;

export const rejectReasonSchema = z
  .string("A reason is required to reject a submission")
  .trim()
  .min(1, "A reason is required to reject a submission")
  .max(5_000, "Reason is too long");

/** Parse input against a schema, converting failures into the domain
 *  ValidationError (HTTP 400) with a readable message. */
export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
    throw new ValidationError(message, result.error.issues);
  }
  return result.data;
}
