import {
  boolean,
  date,
  datetime,
  json,
  table,
  text,
  uuid,
  varchar,
  int,
  duration,
  relations,
  hasOne,
  hasMany,
  belongsTo,
} from "@dsqlbase/schema";

export interface ProjectSettings {
  notificationsEnabled: boolean;
  theme: "light" | "dark";
}

const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", 100).notNull(),
  slug: text("slug").notNull().unique(),
  description: varchar("description", 500),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: datetime("created_at", { mode: "iso" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "iso" }).notNull(),
});

teams.index("teams_slug_idx", { unique: true });

const members = table("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

members.index("team_members_team_user_idx", { unique: true });

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

users.index("users_email_idx", { unique: true });

const projects = table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  name: text("name").notNull(),
  key: text("key").notNull(),
  description: varchar("description", 5000),
  isArchived: boolean("is_archived").notNull(),
  budgetHours: duration("budget_hours", { mode: "iso" }),
  settings: json("settings").$type<ProjectSettings>(),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

projects.index("projects_team_key_idx", { unique: true });
projects.index("projects_team_idx", { unique: true });

const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  assigneeId: uuid("assignee_id"),
  taskNumber: text("task_number").notNull(),
  title: text("title").notNull(),
  description: varchar("description", 5000),
  status: text("status").notNull(),
  priority: int("priority").notNull(),
  dueDate: date("due_date"),
  completedAt: datetime("completed_at"),
  deletedAt: datetime("deleted_at"),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

tasks.index("tasks_project_idx");
tasks.index("tasks_assignee_idx");
tasks.index("tasks_status_idx");
tasks.index("tasks_due_data_idx");

const userRelations = relations(users, {
  membership: hasOne(members, {
    from: [users.columns.id],
    to: [members.columns.userId],
  }),
  tasks: hasMany(tasks, {
    from: [users.columns.id],
    to: [tasks.columns.assigneeId],
  }),
});

const memberRelations = relations(members, {
  user: belongsTo(users, {
    from: [members.columns.userId],
    to: [users.columns.id],
  }),
  team: belongsTo(teams, {
    from: [members.columns.teamId],
    to: [teams.columns.id],
  }),
});

const teamRelations = relations(teams, {
  members: hasMany(members, {
    from: [teams.columns.id],
    to: [members.columns.teamId],
  }),
  projects: hasMany(projects, {
    from: [teams.columns.id],
    to: [projects.columns.teamId],
  }),
});

const projectRelations = relations(projects, {
  team: belongsTo(teams, {
    from: [projects.columns.teamId],
    to: [teams.columns.id],
  }),
  tasks: hasMany(tasks, {
    from: [projects.columns.id],
    to: [tasks.columns.projectId],
  }),
});

const taskRelations = relations(tasks, {
  project: belongsTo(projects, {
    from: [tasks.columns.projectId],
    to: [projects.columns.id],
  }),
  assignee: belongsTo(users, {
    from: [tasks.columns.assigneeId],
    to: [users.columns.id],
  }),
});

export {
  teams,
  members,
  users,
  projects,
  tasks,
  userRelations,
  memberRelations,
  teamRelations,
  projectRelations,
  taskRelations,
};
