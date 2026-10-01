import {
  bigint,
  boolean,
  date,
  datetime,
  json,
  jsonb,
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
  tenantScope,
  guid,
  union,
  $enum,
} from "dsqlbase/schema";
import { z } from "zod";

export type ProjectSettings = {
  notificationsEnabled: boolean;
  theme: "light" | "dark";
};

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

// Declares metadata and is keyed under an alias that differs from its database name, so
// `$$meta` has something to get wrong: `key` is "members", `table` is "team_members".
const members = table("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
}).meta({ __typename: "TeamMember" });

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
  teamId: uuid("team_id"),
  assigneeId: uuid("assignee_id"),
  parentId: uuid("parent_id"),
  taskNumber: text("task_number").notNull(),
  title: text("title").notNull(),
  description: varchar("description", 5000),
  status: taskStatus.column("status").notNull(),
  priority: priorityLevel.column("priority").notNull(),
  dueDate: date("due_date"),
  estimateSeconds: bigint("estimate_seconds"),
  completedAt: datetime("completed_at"),
  deletedAt: datetime("deleted_at"),
  createdAt: datetime("created_at").notNull().defaultNow(),
  updatedAt: datetime("updated_at").notNull().defaultNow(),
}).meta({ __typename: "Task" });

tasks.index("tasks_project_idx").columns((c) => [c.projectId]);
tasks.index("tasks_assignee_idx").columns((c) => [c.assigneeId]);
tasks.index("tasks_status_idx").columns((c) => [c.status]);
tasks
  .index("tasks_due_date_idx")
  .columns((c) => [c.dueDate])
  .include((c) => [c.status]);

/**
 * A second, tenant-scoped half of the fixture, kept apart from the tables above so every other
 * spec keeps running against an unscoped client.
 *
 * `workspaces` is global and owns tenant-scoped `documents`, which in turn own tenant-scoped
 * `comments` — so a scoped read has to carry the predicate into two nested levels, not just the
 * one below the root.
 */
const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

const workspaces = table("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

const documents = ws
  .table("documents", {
    id: uuid("id").primaryKey().defaultRandom(),
    // Points at a global table, so a join from `users` correlates on something other than the
    // claim column — the only shape where the tenant predicate, rather than the correlation,
    // is what keeps another workspace's rows out.
    authorId: uuid("author_id"),
    title: text("title").notNull(),
    body: varchar("body", 5000),
    createdAt: datetime("created_at").notNull().defaultNow(),
  })
  .meta({ __typename: "Document" });

// Keyed under an alias that differs from its database name, like `members` above.
const comments = ws.table("document_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
});

// The claim column leads, which is the shape the guide recommends for a tenant table.
documents.index("documents_workspace_idx").columns((c) => [c.workspaceId, c.id]);
comments.index("document_comments_workspace_idx").columns((c) => [c.workspaceId, c.documentId]);

const workspaceRelations = relations(workspaces, {
  documents: hasMany(documents, {
    from: [workspaces.columns.id],
    to: [documents.columns.workspaceId],
  }),
});

const documentRelations = relations(documents, {
  workspace: belongsTo(workspaces, {
    from: [documents.columns.workspaceId],
    to: [workspaces.columns.id],
  }),
  comments: hasMany(comments, {
    from: [documents.columns.id],
    to: [comments.columns.documentId],
  }),
});

const commentRelations = relations(comments, {
  document: belongsTo(documents, {
    from: [comments.columns.documentId],
    to: [documents.columns.id],
  }),
});

// A second declaration for `users`, merged with `userRelations` by the registry.
const userDocumentRelations = relations(users, {
  authoredDocuments: hasMany(documents, {
    from: [users.columns.id],
    to: [documents.columns.authorId],
  }),
});

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
  // Self-referential: both sides of the join are the same table.
  parent: belongsTo(tasks, {
    from: [tasks.columns.parentId],
    to: [tasks.columns.id],
  }),
  subtasks: hasMany(tasks, {
    from: [tasks.columns.id],
    to: [tasks.columns.parentId],
  }),
  // Two-column relation: the assignee's membership record within this task's team.
  assigneeMembership: belongsTo(members, {
    from: [tasks.columns.teamId, tasks.columns.assigneeId],
    to: [members.columns.teamId, members.columns.userId],
  }),
});

/**
 * Node tables — addressable by global id.
 *
 * Additive on purpose. Every table above keeps its `uuid()` key, so each existing spec runs
 * against raw ids exactly as it always has and nothing here has to be read twice.
 *
 * `authors` owns `articles`, which own `revisions`. `articles.authorId` is a *keyed* guid, so
 * `article.authorId` and `article.author.id` have to be the same string; `revisions` is keyed
 * under an alias that differs from its database name, so a node key follows the name the
 * client uses rather than the physical one. `tags` is deliberately **not** a node: a uuid key
 * is just a uuid key, and `articleTags` has a composite key, which `guid()` cannot name.
 */
const authors = table("authors", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
}).meta({ __typename: "Author" });

const articles = table("articles", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id", "authors").notNull(),
  title: text("title").notNull(),
  body: varchar("body", 5000),
}).meta({ __typename: "Article" });

// Keyed under an alias that differs from its database name, so its node key is "revisions".
const revisions = table("article_revisions", {
  id: guid("id").primaryKey().defaultRandom(),
  articleId: guid("article_id", "articles").notNull(),
  note: text("note").notNull(),
});

/**
 * A node that is also tenant-scoped, so the two features have to compose: `$findByGlobalId`
 * goes through the model client, which means the tenant predicate applies to a node lookup
 * without the lookup knowing anything about tenancy.
 */
const drafts = ws.table("drafts", {
  id: guid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

// Not a node: a plain uuid key names nothing.
const tags = table("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull().unique(),
});

// Not a node either: a composite key cannot be carried by a single guid() column.
const articleTags = table("article_tags", {
  articleId: guid("article_id", "articles"),
  tagId: uuid("tag_id"),
});

// Not chained: `primaryKey()` returns the constraint, not the table.
articleTags.primaryKey((c) => [c.articleId, c.tagId]);

const authorRelations = relations(authors, {
  articles: hasMany(articles, {
    from: [authors.columns.id],
    to: [articles.columns.authorId],
  }),
});

const articleRelations = relations(articles, {
  author: belongsTo(authors, {
    from: [articles.columns.authorId],
    to: [authors.columns.id],
  }),
  revisions: hasMany(revisions, {
    from: [articles.columns.id],
    to: [revisions.columns.articleId],
  }),
});

const revisionRelations = relations(revisions, {
  article: belongsTo(articles, {
    from: [revisions.columns.articleId],
    to: [articles.columns.id],
  }),
});

/**
 * Polymorphic relations — unions of tables.
 *
 * Additive, like the node tables: nothing above changes shape.
 *
 * - `posts` unions two nodes, `photos` and `videos`, written by `authors`. Their author key is
 *   one shared field stored under two column names (`author_id`, `owner_id`), and `caption` is
 *   nullable, so ordering and paging across members meet a per-member column and a null.
 * - `postComments` belongs to a post of either kind through a discriminator, with a keyless
 *   `guid()` whose node is read row by row.
 * - `entries` unions `folders` and `files`, and `folders.entries` points back at it: a union
 *   one of whose members is the table the join starts from.
 * - `userFeed` unions tenant-scoped `documents` with global `bookmarks`, so a union join and the
 *   union client have to apply the tenant predicate to one member and not the other.
 */
const photos = table("photos", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id", "authors").notNull(),
  caption: text("caption"),
  createdAt: datetime("created_at").notNull(),
  photoUrl: text("photo_url").notNull(),
}).meta({ __typename: "Photo" });

const videos = table("videos", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("owner_id", "authors").notNull(),
  caption: text("caption"),
  createdAt: datetime("created_at").notNull(),
  videoUrl: text("video_url").notNull(),
}).meta({ __typename: "Video" });

const posts = union({ photos, videos });

const postComments = table("post_comments", {
  id: guid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type"),
  subjectId: guid("subject_id"),
  body: text("body").notNull(),
});

const folders = table("folders", {
  id: guid("id").primaryKey().defaultRandom(),
  parentId: guid("parent_id", "folders"),
  name: text("name").notNull(),
});

const files = table("files", {
  id: guid("id").primaryKey().defaultRandom(),
  parentId: guid("parent_id", "folders"),
  name: text("name").notNull(),
  size: bigint("size").notNull(),
});

const entries = union({ folders, files });

const bookmarks = table("bookmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id"),
  title: text("title").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
});

const userFeed = union({ documents, bookmarks });

// A second block for `authors`, merged with `authorRelations`.
const authorPostRelations = relations(authors, {
  posts: hasMany(posts, { from: [authors.columns.id], to: [posts.columns.authorId] }),
  latestPost: hasOne(posts, { from: [authors.columns.id], to: [posts.columns.authorId] }),
});

const photoRelations = relations(photos, {
  author: belongsTo(authors, { from: [photos.columns.authorId], to: [authors.columns.id] }),
});

const postCommentRelations = relations(postComments, {
  subject: belongsTo(posts, {
    from: [postComments.columns.subjectId],
    to: [posts.columns.id],
    discriminator: postComments.columns.subjectType,
  }),
});

const folderRelations = relations(folders, {
  entries: hasMany(entries, { from: [folders.columns.id], to: [entries.columns.parentId] }),
});

const userFeedRelations = relations(users, {
  feed: hasMany(userFeed, { from: [users.columns.id], to: [userFeed.columns.authorId] }),
});

/**
 * JSON columns: `config` validated by a zod schema with a default and a coercion, `payload` any
 * JSON value, `notes` the older `json` type.
 */
const BoardConfig = z.object({
  kind: z.enum(["kanban", "list"]),
  columns: z.number().int().positive().default(3),
  since: z.coerce.date().optional(),
});

const boards = table("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").schema(BoardConfig).notNull(),
  payload: jsonb("payload"),
  notes: json("notes"),
});

const boardRelations = relations(boards, {
  project: belongsTo(projects, { from: [boards.columns.projectId], to: [projects.columns.id] }),
});

const projectBoardRelations = relations(projects, {
  boards: hasMany(boards, { from: [projects.columns.id], to: [boards.columns.projectId] }),
});

export {
  teams,
  members,
  users,
  projects,
  tasks,
  ws,
  workspaces,
  documents,
  comments,
  authors,
  articles,
  revisions,
  drafts,
  tags,
  articleTags,
  taskStatus,
  priorityLevel,
  taskNumberSeq,
  userRelations,
  memberRelations,
  teamRelations,
  projectRelations,
  taskRelations,
  workspaceRelations,
  documentRelations,
  commentRelations,
  userDocumentRelations,
  authorRelations,
  articleRelations,
  revisionRelations,
  photos,
  videos,
  posts,
  postComments,
  folders,
  files,
  entries,
  bookmarks,
  userFeed,
  authorPostRelations,
  photoRelations,
  postCommentRelations,
  folderRelations,
  userFeedRelations,
  boards,
  boardRelations,
  projectBoardRelations,
};
