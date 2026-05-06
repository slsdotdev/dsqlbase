import {
  boolean,
  date,
  datetime,
  json,
  table,
  text,
  uuid,
  varchar,
  duration,
  relations,
  hasOne,
  hasMany,
  belongsTo,
  sequence,
  $enum,
} from "dsqlbase/schema";

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
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
});

teams.index("teams_slug_idx", { unique: true }).columns((c) => [c.slug]);

const members = table("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
});

members.unique((c) => [c.teamId, c.userId]);
members
  .index("team_members_team_user_idx")
  .columns((c) => [c.teamId, c.userId])
  .unique();

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
});

users.index("users_email_idx", { unique: true }).columns((c) => [c.email]);

const projects = table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  name: text("name").notNull(),
  key: text("key").notNull(),
  description: varchar("description", 5000),
  isArchived: boolean("is_archived").notNull().default(false),
  budgetHours: duration("budget_hours", { mode: "iso" }),
  settings: json("settings").$type<ProjectSettings>(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
});

projects.index("projects_team_key_idx", { unique: true }).columns((c) => [c.teamId, c.key]);
projects.index("projects_team_idx").columns((c) => [c.teamId]);

const taskStatus = $enum("task_status", ["todo", "in_progress", "done", "archived"]);
const priorityLevel = $enum("priority_level", ["urgent", "high", "medium", "low", "none"]);

const taskNumberSeq = sequence("task_number_seq").startWith(1).incrementBy(1);

const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  assigneeId: uuid("assignee_id"),
  taskNumber: text("task_number").notNull(),
  title: text("title").notNull(),
  description: varchar("description", 5000),
  status: taskStatus.column("status").notNull(),
  priority: priorityLevel.column("priority").notNull(),
  dueDate: date("due_date"),
  completedAt: datetime("completed_at"),
  deletedAt: datetime("deleted_at"),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
});

tasks.index("tasks_project_idx").columns((c) => [c.projectId]);
tasks.index("tasks_assignee_idx").columns((c) => [c.assigneeId]);
tasks.index("tasks_status_idx").columns((c) => [c.status]);
tasks
  .index("tasks_due_date_idx")
  .columns((c) => [c.dueDate])
  .include((c) => [c.status]);

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
  taskStatus,
  priorityLevel,
  taskNumberSeq,
  userRelations,
  memberRelations,
  teamRelations,
  projectRelations,
  taskRelations,
};
