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
  // Node tables. Ids here are the **raw** uuids the database holds: these rows are inserted
  // with raw SQL, so nothing has wrapped them. A spec wraps one with `encodeGlobalId` when it
  // wants the form a client would hand back.
  authors: { id: string; name: string }[];
  articles: { id: string; authorId: string; title: string }[];
  revisions: { id: string; articleId: string; note: string }[];
  drafts: { id: string; workspaceId: string; title: string }[];
  // Union members. Raw uuids again; `createdAt` as an ISO string, so a spec can sort by it.
  photos: { id: string; authorId: string; caption: string | null; createdAt: string }[];
  videos: { id: string; authorId: string; caption: string | null; createdAt: string }[];
  postComments: { id: string; subjectType: string; subjectId: string; body: string }[];
  folders: { id: string; parentId: string | null; name: string }[];
  files: { id: string; parentId: string | null; name: string }[];
  bookmarks: { id: string; authorId: string | null; title: string }[];
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

export async function seedAuthors(client: TestClient) {
  const query = sql`
    INSERT INTO "authors" ("name") VALUES
      ('Ada Lovelace'),
      ('Grace Hopper')
    RETURNING "id", "name"
  `;

  return await client.$query<{ id: string; name: string }>(query);
}

export async function seedArticles(client: TestClient, authors: SeededData["authors"]) {
  const query = sql`
    INSERT INTO "articles" ("author_id", "title", "body") VALUES
      (${authors[0].id}, 'On analytical engines', 'The first program'),
      (${authors[0].id}, 'Notes on translation', 'Sketch of the engine'),
      (${authors[1].id}, 'On compilers', 'A language for machines')
    RETURNING "id", "author_id", "title"
  `;

  const rows = await client.$query<{ id: string; author_id: string; title: string }>(query);

  return rows.map((row) => ({ id: row.id, authorId: row.author_id, title: row.title }));
}

export async function seedRevisions(client: TestClient, articles: SeededData["articles"]) {
  const query = sql`
    INSERT INTO "article_revisions" ("article_id", "note") VALUES
      (${articles[0].id}, 'First draft'),
      (${articles[0].id}, 'Second pass'),
      (${articles[2].id}, 'Only draft')
    RETURNING "id", "article_id", "note"
  `;

  const rows = await client.$query<{ id: string; article_id: string; note: string }>(query);

  return rows.map((row) => ({ id: row.id, articleId: row.article_id, note: row.note }));
}

export async function seedDrafts(client: TestClient, workspaces: SeededData["workspaces"]) {
  const query = sql`
    INSERT INTO "drafts" ("workspace_id", "title") VALUES
      (${workspaces[0].id}, 'Acme draft'),
      (${workspaces[1].id}, 'Globex draft')
    RETURNING "id", "workspace_id", "title"
  `;

  const rows = await client.$query<{ id: string; workspace_id: string; title: string }>(query);

  return rows.map((row) => ({ id: row.id, workspaceId: row.workspace_id, title: row.title }));
}

type PostRow = { id: string; author_id: string; caption: string | null; created_at: Date };

const toPost = (row: PostRow) => ({
  id: row.id,
  authorId: row.author_id,
  caption: row.caption,
  createdAt: new Date(row.created_at).toISOString(),
});

/**
 * The first author posts on three days, and three of their posts share 2026-01-03 — two photos
 * and a video — so an order by `createdAt` has ties inside one member and across two.
 */
export async function seedPhotos(client: TestClient, authors: SeededData["authors"]) {
  const rows = await client.$query<PostRow>(sql`
    INSERT INTO "photos" ("author_id", "caption", "created_at", "photo_url") VALUES
      (${authors[0].id}, 'Sunrise', '2026-01-01T00:00:00Z', 'sunrise.jpg'),
      (${authors[0].id}, NULL, '2026-01-03T00:00:00Z', 'untitled.jpg'),
      (${authors[0].id}, 'Tie', '2026-01-03T00:00:00Z', 'tie.jpg'),
      (${authors[1].id}, NULL, '2026-01-05T00:00:00Z', 'compiler.jpg')
    RETURNING "id", "author_id", "caption", "created_at"
  `);

  return rows.map(toPost);
}

export async function seedVideos(client: TestClient, authors: SeededData["authors"]) {
  const rows = await client.$query<PostRow>(sql`
    INSERT INTO "videos" ("owner_id", "caption", "created_at", "video_url") VALUES
      (${authors[0].id}, 'Clip', '2026-01-02T00:00:00Z', 'clip.mp4'),
      (${authors[0].id}, NULL, '2026-01-03T00:00:00Z', 'tie.mp4'),
      (${authors[1].id}, 'Talk', '2026-01-04T00:00:00Z', 'talk.mp4')
    RETURNING "id", "owner_id" AS "author_id", "caption", "created_at"
  `);

  return rows.map(toPost);
}

export async function seedPostComments(
  client: TestClient,
  photos: SeededData["photos"],
  videos: SeededData["videos"]
) {
  const rows = await client.$query<{
    id: string;
    subject_type: string;
    subject_id: string;
    body: string;
  }>(sql`
    INSERT INTO "post_comments" ("subject_type", "subject_id", "body") VALUES
      ('photos', ${photos[0].id}, 'Lovely light'),
      ('videos', ${videos[0].id}, 'Great clip')
    RETURNING "id", "subject_type", "subject_id", "body"
  `);

  return rows.map((row) => ({
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    body: row.body,
  }));
}

/** `root` holds `child` and two files; `child` holds one file. */
export async function seedEntries(client: TestClient) {
  type Row = { id: string; parent_id: string | null; name: string };
  const toEntry = (row: Row) => ({ id: row.id, parentId: row.parent_id, name: row.name });

  const [root] = await client.$query<Row>(sql`
    INSERT INTO "folders" ("name") VALUES ('root') RETURNING "id", "parent_id", "name"
  `);
  const [child] = await client.$query<Row>(sql`
    INSERT INTO "folders" ("parent_id", "name") VALUES (${root.id}, 'child')
    RETURNING "id", "parent_id", "name"
  `);
  const files = await client.$query<Row>(sql`
    INSERT INTO "files" ("parent_id", "name", "size") VALUES
      (${root.id}, 'a.txt', 1),
      (${root.id}, 'b.txt', 2),
      (${child.id}, 'c.txt', 3)
    RETURNING "id", "parent_id", "name"
  `);

  return { folders: [root, child].map(toEntry), files: files.map(toEntry) };
}

export async function seedBookmarks(client: TestClient, users: SeededData["users"]) {
  const rows = await client.$query<{ id: string; author_id: string | null; title: string }>(sql`
    INSERT INTO "bookmarks" ("author_id", "title") VALUES
      (${users[0].id}, 'Read later'),
      (${users[1].id}, 'Reference')
    RETURNING "id", "author_id", "title"
  `);

  return rows.map((row) => ({ id: row.id, authorId: row.author_id, title: row.title }));
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

  const authors = await seedAuthors(client);
  const articles = await seedArticles(client, authors);
  const revisions = await seedRevisions(client, articles);
  const drafts = await seedDrafts(client, workspaces);

  const photos = await seedPhotos(client, authors);
  const videos = await seedVideos(client, authors);
  const postComments = await seedPostComments(client, photos, videos);
  const { folders, files } = await seedEntries(client);
  const bookmarks = await seedBookmarks(client, users);

  return {
    teams,
    users,
    members,
    projects,
    tasks,
    workspaces,
    documents,
    comments,
    authors,
    articles,
    revisions,
    drafts,
    photos,
    videos,
    postComments,
    folders,
    files,
    bookmarks,
  };
}
