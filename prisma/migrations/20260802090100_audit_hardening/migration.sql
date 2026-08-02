-- Audit-trail hardening (hand-written; Prisma's schema DSL cannot express
-- triggers, CHECK constraints, or partial indexes).
--
-- Threat model, stated honestly: these guards protect the audit trail against
-- APPLICATION BUGS — a stray update, a buggy cleanup script, an ORM misuse.
-- They do not protect against a privileged attacker: the app connects as the
-- table owner here, which could drop these objects. Production hardening would
-- run the app as a non-owner role with only SELECT/INSERT on audit_events and
-- run migrations under a separate role.

-- ---------------------------------------------------------------------------
-- 1. audit_events is append-only: reject UPDATE, DELETE, and TRUNCATE.
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER audit_events_block_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- TRUNCATE does not fire row-level triggers; it needs a statement-level guard.
CREATE TRIGGER audit_events_block_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

-- ---------------------------------------------------------------------------
-- 2. A rejection must carry a non-empty reason (also enforced in the service
--    layer; this is the deepest backstop for a literal product requirement).
-- ---------------------------------------------------------------------------
ALTER TABLE audit_events ADD CONSTRAINT audit_rejection_requires_reason
  CHECK (action <> 'REJECTED' OR (reason IS NOT NULL AND btrim(reason) <> ''));

-- ---------------------------------------------------------------------------
-- 3. Every event must describe a legal state-machine transition.
--    The trailing IS TRUE is load-bearing: SQL CHECK constraints pass on NULL,
--    so without it a decision event with from_status = NULL would slip through
--    (each arm evaluates to NULL, not FALSE). IS TRUE forces NULL to fail.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_events ADD CONSTRAINT audit_legal_transition
  CHECK ((
       (action = 'SUBMITTED' AND from_status IS NULL     AND to_status = 'PENDING')
    OR (action = 'APPROVED'  AND from_status = 'PENDING' AND to_status = 'APPROVED')
    OR (action = 'REJECTED'  AND from_status = 'PENDING' AND to_status = 'REJECTED')
  ) IS TRUE);

-- ---------------------------------------------------------------------------
-- 4. At most one decision event per submission — the database-level backstop
--    for the concurrent-reviewers race. Even if the application's guarded
--    UPDATE were bypassed, a second APPROVED/REJECTED event cannot exist.
--    (Deliberately encodes "decided states are terminal, no resubmission";
--    reintroducing resubmission would replace this with a per-cycle scheme.)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX audit_one_decision_per_submission
  ON audit_events (submission_id)
  WHERE action IN ('APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- 5. Symmetry for the birth event: a submission is SUBMITTED exactly once.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX audit_one_submit_per_submission
  ON audit_events (submission_id)
  WHERE action = 'SUBMITTED';

-- ---------------------------------------------------------------------------
-- 6. The state machine also holds on the submissions table itself: status may
--    only move PENDING -> APPROVED/REJECTED (or stay put). Without this, the
--    audit side is guarded but a buggy unguarded update could still flip a
--    decided submission's status with no matching audit event.
-- ---------------------------------------------------------------------------
CREATE FUNCTION submissions_transition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status
     OR (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'illegal status transition: % -> %', OLD.status, NEW.status;
END;
$$;

CREATE TRIGGER submissions_enforce_transitions
  BEFORE UPDATE OF status ON submissions
  FOR EACH ROW EXECUTE FUNCTION submissions_transition_guard();
