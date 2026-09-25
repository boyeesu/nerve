ALTER TABLE "action_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_requests" ADD COLUMN "last_error" text;
