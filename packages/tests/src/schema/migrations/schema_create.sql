CREATE DOMAIN "task_status" AS text
  CONSTRAINT "chk_task_status" CHECK (VALUE IN ('todo', 'in_progress', 'done', 'cancelled'));
--> statement-breakpoint
CREATE DOMAIN "priority_level" AS integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE SEQUENCE "task_number_seq" AS bigint INCREMENT BY 1 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" varchar(500),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" ("slug");
--> statement-breakpoint
CREATE TABLE "team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL,
  UNIQUE ("team_id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" ("team_id", "user_id");
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email");
--> statement-breakpoint
CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "name" text NOT NULL,
  "key" text NOT NULL,
  "description" varchar(5000),
  "is_archived" boolean NOT NULL,
  "budget_hours" interval,
  "settings" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_key_idx" ON "projects" ("team_id", "key");
--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" ("team_id");
--> statement-breakpoint
CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "assignee_id" uuid,
  "task_number" text NOT NULL,
  "title" text NOT NULL,
  "description" varchar(5000),
  "status" task_status NOT NULL,
  "priority" integer NOT NULL,
  "due_date" date,
  "completed_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" ("project_id");
--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" ("assignee_id");
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" ("status");
--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" ("due_date") INCLUDE ("status");
--> statement-breakpoint
CREATE VIEW "active_teams" AS SELECT "id", "name", "slug" FROM "teams" WHERE "is_active" = true;
--> statement-breakpoint
CREATE FUNCTION "project_count"(team_uuid uuid) RETURNS bigint LANGUAGE SQL AS $$
  SELECT count(*) FROM "projects" WHERE "team_id" = team_uuid;
$$;
