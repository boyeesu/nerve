ALTER TABLE connections ADD COLUMN workspace_id text NOT NULL DEFAULT 'default';
--> statement-breakpoint
DROP INDEX IF EXISTS connections_runtime_endpoint_idx;
CREATE UNIQUE INDEX connections_workspace_endpoint_idx ON connections(workspace_id, runtime, endpoint);
CREATE INDEX connections_workspace_idx ON connections(workspace_id);
--> statement-breakpoint
CREATE TABLE revoked_sessions (
  digest text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  targets jsonb NOT NULL DEFAULT '[]',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX missions_workspace_idx ON missions(workspace_id, created_at);
--> statement-breakpoint
CREATE TABLE audit_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX action_requests_recovery_idx ON action_requests(state, updated_at);
