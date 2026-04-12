import { ColumnDefinition, TableDefinition } from "@dsqlbase/core/definition";

const teams = new TableDefinition("teams", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    slug: new ColumnDefinition("slug").notNull().unique(),
    description: new ColumnDefinition("description"),
    isActive: new ColumnDefinition("is_active").notNull(),
    createdAt: new ColumnDefinition("created_at").notNull(),
    updatedAt: new ColumnDefinition("updated_at").notNull(),
  },
});

teams.index("teams_slug_idx", { unique: true });

const members = new TableDefinition("members", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    teamId: new ColumnDefinition("team_id").notNull(),
    userId: new ColumnDefinition("user_id").notNull(),
    role: new ColumnDefinition("role").notNull(),
    createdAt: new ColumnDefinition("created_at").notNull(),
    updatedAt: new ColumnDefinition("updated_at").notNull(),
  },
});

members.index("members_team_user_idx", { unique: true });

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").notNull().unique(),
    createdAt: new ColumnDefinition("created_at").notNull(),
    updatedAt: new ColumnDefinition("updated_at").notNull(),
  },
});

users.index("users_email_idx", { unique: true });

const projects = new TableDefinition("projects", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    teamId: new ColumnDefinition("team_id").notNull(),
    name: new ColumnDefinition("name").notNull(),
    key: new ColumnDefinition("key").notNull(),
    description: new ColumnDefinition("description"),
    isArchived: new ColumnDefinition("is_archived").notNull(),
    budgetHours: new ColumnDefinition("budget_hours"),
    settings: new ColumnDefinition("settings"),
    createdAt: new ColumnDefinition("created_at").notNull(),
    updatedAt: new ColumnDefinition("updated_at").notNull(),
  },
});

projects.index("projects_team_key_idx", { unique: true });
projects.index("projects_team_idx", { unique: true });

const tasks = new TableDefinition("tasks", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    projectId: new ColumnDefinition("project_id").notNull(),
    assigneeId: new ColumnDefinition("assignee_id"),
    taskNumber: new ColumnDefinition("task_number").notNull(),
    title: new ColumnDefinition("name").notNull(),
    description: new ColumnDefinition("description"),
    status: new ColumnDefinition("status").notNull(),
    priority: new ColumnDefinition("priority").notNull(),
    dueDate: new ColumnDefinition("due_date"),
    completedAt: new ColumnDefinition("completed_at"),
    deletedAt: new ColumnDefinition("deleted_at"),
    createdAt: new ColumnDefinition("created_at").notNull(),
    updatedAt: new ColumnDefinition("updated_at").notNull(),
  },
});

tasks.index("tasks_project_idx");
tasks.index("tasks_assignee_idx");
tasks.index("tasks_status_idx");
tasks.index("tasks_due_data_idx");

export { teams, members, users, projects, tasks };
