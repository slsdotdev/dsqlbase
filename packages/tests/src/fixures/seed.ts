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
}

export async function seedTeams(client: TestClient) {
  const query = sql`
    INSERT INTO "teams" ("name", "slug", "description") VALUES
      ('Engineering', 'engineering', 'Core engineering team'),
      ('Design', 'design', 'Product design team'),
      ('Marketing', 'marketing', 'Growth and marketing team')
    RETURNING "id", "name", "slug"
  `;

  return await client.$raw<{ id: string; name: string; slug: string }>(query);
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

  return await client.$raw<{ id: string; name: string; email: string }>(query);
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
  return await client.$raw<{ id: string; teamId: string; userId: string; role: string }>(query);
}

export async function seedProjects(client: TestClient, teams: SeededData["teams"]) {
  const query = sql`
    INSERT INTO "projects" ("team_id", "name", "key", "description", "is_archived") VALUES
      (${teams[0].id}, 'API Platform', 'API', 'Core API services', ${true}),
      (${teams[0].id}, 'Web Dashboard', 'WEB', 'Admin dashboard', DEFAULT),
      (${teams[1].id}, 'Design System', 'DSN', 'Shared component library', DEFAULT)
    RETURNING "id", "team_id", "name", "key"
  `;
  return await client.$raw<{ id: string; teamId: string; name: string; key: string }>(query);
}

export async function seedTasks(
  client: TestClient,
  projects: SeededData["projects"],
  users: SeededData["users"]
) {
  const query = sql`
    INSERT INTO "tasks" 
      ("project_id", "assignee_id", "task_number", "title", "status", "priority", "due_date") 
    VALUES
      (${projects[0].id}, ${users[0].id}, 1, 'Setup authentication', 'in_progress', 'high', '2026-05-01'),
      (${projects[0].id}, ${users[1].id}, 2, 'Implement rate limiting', 'todo', 'medium', NULL),
      (${projects[0].id}, NULL, 3, 'Write API documentation', 'todo', 'low', '2026-06-01'),
      (${projects[1].id}, ${users[2].id}, 1, 'Dashboard layout', 'done', 'high', NULL),
      (${projects[1].id}, ${users[1].id}, 2, 'User settings page', 'in_progress', 'medium', '2026-05-15'),
      (${projects[2].id}, ${users[3].id}, 1, 'Button component', 'done', 'high', NULL)
    RETURNING "id", "project_id", "assignee_id", "task_number", "title", "status", "priority"
  `;

  const rows = await client.$raw<{
    id: string;
    project_id: string;
    assignee_id: string | null;
    task_number: number;
    title: string;
    status: string;
    priority: string;
  }>(query);

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

export async function seedData(client: TestClient): Promise<SeededData> {
  const teams = await seedTeams(client);
  const users = await seedUsers(client);
  const members = await seedMembers(client, teams, users);
  const projects = await seedProjects(client, teams);
  const tasks = await seedTasks(client, projects, users);

  return { teams, users, members, projects, tasks };
}
