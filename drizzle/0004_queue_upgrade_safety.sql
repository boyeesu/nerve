-- Requests left by versions without a durable worker were never approved for
-- background delivery. Do not execute old commands merely by upgrading Nerve.
UPDATE action_requests
SET state = 'unknown',
    last_error = 'Pending before the durable-worker upgrade. Inspect the runtime and reconcile; this command was not automatically resent.',
    updated_at = now()
WHERE state = 'requested';
