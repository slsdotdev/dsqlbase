CREATE DOMAIN "task_status" AS text CONSTRAINT "chk_task_status" CHECK (VALUE IN ('open', 'in_progress', 'completed', 'archived'));
-- statement breakpoint
CREATE DOMAIN "priority_level" AS int CONSTRAINT "chk_priority_level" CHECK (VALUE IN (1, 2, 3, 4, 5));
-- statement breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" varchar(500),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
-- statement breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_idx" ON "teams" ("slug" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL,
  CONSTRAINT "team_members_unique" UNIQUE NULLS DISTINCT ("team_id", "user_id")
);
-- statement breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_user_idx" ON "team_members" ("team_id" ASC NULLS LAST, "user_id" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
-- statement breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
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
-- statement breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_team_key_idx" ON "projects" ("team_id" ASC NULLS LAST, "key" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE INDEX IF NOT EXISTS "projects_team_idx" ON "projects" ("team_id" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "assignee_id" uuid,
  "task_number" text NOT NULL,
  "title" text NOT NULL,
  "description" varchar(5000),
  "status" task_status NOT NULL,
  "priority" priority_level NOT NULL,
  "due_date" date,
  "completed_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
-- statement breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_idx" ON "tasks" ("project_id" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx" ON "tasks" ("assignee_id" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" ("status" ASC NULLS LAST) NULLS DISTINCT;
-- statement breakpoint
CREATE INDEX IF NOT EXISTS "tasks_due_date_idx" ON "tasks" ("due_date" ASC NULLS LAST) INCLUDE ("status") NULLS DISTINCT;
-- statement breakpoint
CREATE SEQUENCE IF NOT EXISTS "task_number_seq" INCREMENT BY 1 START WITH 1 CACHE 1 NO CYCLE;