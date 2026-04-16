import { Relation, RelationsDefinition } from "@dsqlbase/core/definition";
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
} from "@dsqlbase/schema";

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

export interface ProjectSettings {
  notificationsEnabled: boolean;
  theme: "light" | "dark";
}

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

const userRelations = new RelationsDefinition("users", {
  table: users,
  relations: {
    membership: {
      target: members,
      type: Relation.HAS_ONE,
      from: [users["_columns"].id],
      to: [members["_columns"].userId],
    },
    tasks: {
      target: tasks,
      type: Relation.HAS_MANY,
      from: [users["_columns"].id],
      to: [tasks["_columns"].assigneeId],
    },
  },
});

const memberRelations = new RelationsDefinition("team_members", {
  table: members,
  relations: {
    user: {
      target: users,
      type: Relation.BELONGS_TO,
      from: [members["_columns"].userId],
      to: [users["_columns"].id],
    },
    team: {
      target: teams,
      type: Relation.BELONGS_TO,
      from: [members["_columns"].teamId],
      to: [teams["_columns"].id],
    },
  },
});

const teamRelations = new RelationsDefinition("teams", {
  table: teams,
  relations: {
    members: {
      target: members,
      type: Relation.HAS_MANY,
      from: [teams["_columns"].id],
      to: [members["_columns"].teamId],
    },
    projects: {
      target: projects,
      type: Relation.HAS_MANY,
      from: [teams["_columns"].id],
      to: [projects["_columns"].teamId],
    },
  },
});

const projectRelations = new RelationsDefinition("projects", {
  table: projects,
  relations: {
    team: {
      target: teams,
      type: Relation.BELONGS_TO,
      from: [projects["_columns"].teamId],
      to: [teams["_columns"].id],
    },
    tasks: {
      target: tasks,
      type: Relation.HAS_MANY,
      from: [projects["_columns"].id],
      to: [tasks["_columns"].projectId],
    },
  },
});

const taskRelations = new RelationsDefinition("tasks", {
  table: tasks,
  relations: {
    project: {
      target: projects,
      type: Relation.BELONGS_TO,
      from: [tasks["_columns"].projectId],
      to: [projects["_columns"].id],
    },
    assignee: {
      target: users,
      type: Relation.BELONGS_TO,
      from: [tasks["_columns"].assigneeId],
      to: [users["_columns"].id],
    },
  },
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
