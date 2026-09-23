import { sql } from "@dsqlbase/core";
import { TestClient } from "../db";

export interface SeededData {
  teams: { id: string; name: string; slug: string }[];
  users: { id: string; name: string; email: string }[];
  members: { id: string; teamId: string; userId: string; role: string }[];
  projects: { id: string; teamId: string; name: string; key: string }[];
  tasks: {
    id: string;
    projectId: string;
    assigneeId: string | null;
    taskNumber: number;
    title: string;
    status: string;
    priority: string;
  }[];
  workspaces: { id: string; name: string; slug: string }[];
  documents: { id: string; workspaceId: string; authorId: string | null; title: string }[];
  comments: { id: string; workspaceId: string; documentId: string; author: string }[];
}

export async function seedTeams(client: TestClient) {
  const query = sql`
    INSERT INTO "teams" ("name", "slug", "description") VALUES
      ('Engineering', 'engineering', 'Core engineering team'),
      ('Design', 'design', 'Product design team'),
      ('Marketing', 'marketing', 'Growth and marketing team')
    RETURNING "id", "name", "slug"
  `;

  return await client.$query<{ id: string; name: string; slug: string }>(query);
}

export async function seedUsers(client: TestClient) {
  const query = sql`
    INSERT INTO "users" ("name", "email") VALUES
      ('Alice Johnson', 'alice@example.com'),
      ('Bob Smith', 'bob@example.com'),
      ('Carol Williams', 'carol@example.com'),
      ('Dave Brown', 'dave@example.com')
    RETURNING "id", "name", "email"
  `;

  return await client.$query<{ id: string; name: string; email: string }>(query);
}

export async function seedMembers(
  client: TestClient,
  teams: SeededData["teams"],
  users: SeededData["users"]
) {
  const query = sql`
    INSERT INTO "team_members" ("team_id", "user_id", "role") VALUES
      (${teams[0].id}, ${users[0].id}, 'admin'),
      (${teams[0].id}, ${users[1].id}, 'member'),
      (${teams[0].id}, ${users[2].id}, 'member'),
      (${teams[1].id}, ${users[2].id}, 'admin'),
      (${teams[1].id}, ${users[3].id}, 'member'),
      (${teams[2].id}, ${users[3].id}, 'admin')
    RETURNING "id", "team_id", "user_id", "role"
  `;
  return await client.$query<{ id: string; teamId: string; userId: string; role: string }>(query);
}

export async function seedProjects(client: TestClient, teams: SeededData["teams"]) {
  const query = sql`
    INSERT INTO "projects" ("team_id", "name", "key", "description", "is_archived", "budget_hours") VALUES
      (${teams[0].id}, 'API Platform', 'API', 'Core API services', ${true}, 'PT8H'),
      (${teams[0].id}, 'Web Dashboard', 'WEB', 'Admin dashboard', DEFAULT, 'PT40H'),
      (${teams[1].id}, 'Design System', 'DSN', 'Shared component library', DEFAULT, NULL)
    RETURNING "id", "team_id", "name", "key"
  `;
  return await client.$query<{ id: string; teamId: string; name: string; key: string }>(query);
}

export async function seedTasks(
  client: TestClient,
  projects: SeededData["projects"],
  users: SeededData["users"]
) {
  const query = sql`
    INSERT INTO "tasks" 
      ("project_id", "assignee_id", "task_number", "title", "status", "priority", "due_date",
       "estimate_seconds", "completed_at") 
    VALUES
      (${projects[0].id}, ${users[0].id}, 1, 'Setup authentication', 'in_progress', 'high', '2026-05-01', 9007199254740993, NULL),
      (${projects[0].id}, ${users[1].id}, 2, 'Implement rate limiting', 'todo', 'medium', NULL, 3600, NULL),
      (${projects[0].id}, NULL, 3, 'Write API documentation', 'todo', 'low', '2026-06-01', NULL, NULL),
      (${projects[1].id}, ${users[2].id}, 1, 'Dashboard layout', 'done', 'high', NULL, 7200, '2026-03-04T05:06:07Z'),
      (${projects[1].id}, ${users[1].id}, 2, 'User settings page', 'in_progress', 'medium', '2026-05-15', NULL, NULL),
      (${projects[2].id}, ${users[3].id}, 1, 'Button component', 'done', 'high', NULL, 7200, '2026-04-05T06:07:08Z')
    RETURNING "id", "project_id", "assignee_id", "task_number", "title", "status", "priority"
  `;

  const rows = await client.$query<{
    id: string;
    project_id: string;
    assignee_id: string | null;
    task_number: number;
    title: string;
    status: string;
    priority: string;
  }>(query);

  // Denormalise the owning team so the composite relation has both of its columns.
  await client.$query(
    sql`UPDATE "tasks" SET "team_id" = "projects"."team_id"
        FROM "projects" WHERE "tasks"."project_id" = "projects"."id"`
  );

  // Give the self-relation something to resolve: tasks 2 and 3 are children of task 1.
  await client.$query(
    sql`UPDATE "tasks" SET "parent_id" = ${rows[0].id} WHERE "id" IN (${sql.join(
      [sql.param(rows[1].id), sql.param(rows[2].id)],
      ", "
    )})`
  );

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    assigneeId: r.assignee_id,
    taskNumber: r.task_number,
    title: r.title,
    status: r.status,
    priority: r.priority,
  }));
}

export async function seedWorkspaces(client: TestClient) {
  const query = sql`
    INSERT INTO "workspaces" ("name", "slug") VALUES
      ('Acme', 'acme'),
      ('Globex', 'globex')
    RETURNING "id", "name", "slug"
  `;

  return await client.$query<{ id: string; name: string; slug: string }>(query);
}

export async function seedDocuments(
  client: TestClient,
  workspaces: SeededData["workspaces"],
  users: SeededData["users"]
) {
  // The same author writes in both workspaces, so a join from `users` reaches documents the
  // scoped client must not see.
  const query = sql`
    INSERT INTO "documents" ("workspace_id", "author_id", "title", "body") VALUES
      (${workspaces[0].id}, ${users[0].id}, 'Acme roadmap', 'Where Acme is going'),
      (${workspaces[0].id}, ${users[1].id}, 'Acme onboarding', 'How to start at Acme'),
      (${workspaces[1].id}, ${users[0].id}, 'Globex roadmap', 'Where Globex is going')
    RETURNING "id", "workspace_id", "author_id", "title"
  `;

  const rows = await client.$query<{
    id: string;
    workspace_id: string;
    author_id: string | null;
    title: string;
  }>(query);

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    authorId: row.author_id,
    title: row.title,
  }));
}

export async function seedComments(client: TestClient, documents: SeededData["documents"]) {
  const query = sql`
    INSERT INTO "document_comments" ("workspace_id", "document_id", "author", "body") VALUES
      (${documents[0].workspaceId}, ${documents[0].id}, 'alice', 'Looks good'),
      (${documents[0].workspaceId}, ${documents[0].id}, 'bob', 'One question'),
      (${documents[1].workspaceId}, ${documents[1].id}, 'alice', 'Ship it'),
      (${documents[2].workspaceId}, ${documents[2].id}, 'carol', 'Globex only')
    RETURNING "id", "workspace_id", "document_id", "author"
  `;

  const rows = await client.$query<{
    id: string;
    workspace_id: string;
    document_id: string;
    author: string;
  }>(query);

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    author: row.author,
  }));
}

export async function seedData(client: TestClient): Promise<SeededData> {
  const teams = await seedTeams(client);
  const users = await seedUsers(client);
  const members = await seedMembers(client, teams, users);
  const projects = await seedProjects(client, teams);
  const tasks = await seedTasks(client, projects, users);

  // Seeded through raw SQL like everything else, so the rows exist regardless of what the model
  // clients would or would not allow — which is the point of the isolation specs.
  const workspaces = await seedWorkspaces(client);
  const documents = await seedDocuments(client, workspaces, users);
  const comments = await seedComments(client, documents);

  return { teams, users, members, projects, tasks, workspaces, documents, comments };
}
