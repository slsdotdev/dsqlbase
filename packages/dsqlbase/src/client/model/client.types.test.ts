import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import {
  ExecutableQuery,
  ExecutionContext,
  QueryBuilder,
  SchemaRegistry,
} from "@dsqlbase/core/runtime";
import { createClient } from "../create.js";
import { ModelClient } from "./client.js";
import {
  array,
  belongsTo,
  bigint,
  embedded,
  datetime,
  hasMany,
  json,
  jsonb,
  record,
  relations,
  table,
  tenantScope,
  text,
  union,
  uuid,
} from "../../schema/index.js";
import type { StandardSchemaV1 } from "../../schema/utils/standard-schema.js";

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  emailAddress: text("email_address").notNull().unique(),
  phoneNumber: text("phone_number"),
  address: text("address"),
});

const contacts = table("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  value: text("value").notNull(),
});

const userRelations = relations(users, {
  contacts: hasMany(contacts, {
    from: [users.columns.id],
    to: [contacts.columns.userId],
  }),
});

const contactsRelations = relations(contacts, {
  owner: belongsTo(users, {
    from: [contacts.columns.userId],
    to: [users.columns.id],
  }),
});

const schema = {
  users,
  contacts,
  userRelations,
  contactsRelations,
};

const mockSession = {
  execute: vi.fn(),
};

const context = new ExecutionContext({
  dialect: new QueryBuilder(),
  schema: new SchemaRegistry(schema),
  session: mockSession,
});

const tables = context.schema.getTables();
const client = new ModelClient(context, tables.users);

/**
 * Every result record carries `$$meta`. Neither fixture table declares `table().meta()`, so
 * only the built-ins are present; the declared half is covered separately below.
 */
type Meta<TAlias extends string> = {
  key: TAlias;
  table: string;
  schema?: string;
};

describe("ModelClient", () => {
  it("should infer return type based on `return` selection", async () => {
    const query = client.create({
      data: {
        id: "123",
        firstName: "John",
        lastName: "Doe",
        emailAddress: "john@email.com",
        address: "123 Main St",
      },
      return: {
        id: true,
      },
    });

    expect(query).toBeInstanceOf(ExecutableQuery);
    expectTypeOf(query.$typeOf).toEqualTypeOf<{ id: string; $$meta: Meta<"users"> } | null>();
  });

  it("should infer return type as null if no fields are selected", async () => {
    const query = client.create({
      data: {
        id: "123",
        firstName: "John",
        lastName: "Doe",
        emailAddress: "john@email.com",
      },
    });

    expect(query).toBeInstanceOf(ExecutableQuery);
    expectTypeOf(query.$typeOf).toEqualTypeOf<null>();
  });

  it("should infer return type as full record if `return` is true", async () => {
    const query = client.create({
      data: {
        firstName: "John",
        lastName: "Doe",
        emailAddress: "john@mail.com",
      },
      return: true,
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<{
      id: string;
      firstName: string;
      lastName: string;
      emailAddress: string;
      phoneNumber: string | null;
      address: string | null;
      $$meta: Meta<"users">;
    } | null>();
  });

  it("should infer args type for findOne", async () => {
    expectTypeOf(
      client.findOne({
        where: { id: { eq: "123" } },
        select: {
          id: true,
          firstName: true,
        },
      })
    ).toEqualTypeOf<
      ExecutableQuery<{
        id: string;
        firstName: string;
        $$meta: Meta<"users">;
      } | null>
    >();
  });

  it("should infer args type for findMany", async () => {
    const query = client.findMany({
      where: { firstName: { eq: "John" } },
      distinct: true,
      select: {
        id: true,
        lastName: true,
      },
      limit: 10,
      offset: 20,
      orderBy: { lastName: "asc" },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<
      { id: string; lastName: string; $$meta: Meta<"users"> }[]
    >();
  });

  it("should infer joined relations", async () => {
    const query = client.findOne({
      where: { id: "123" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      join: {
        contacts: {
          where: { type: { eq: "email" } },
          select: {
            type: true,
            value: true,
          },
          join: {
            owner: true,
          },
        },
      },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<{
      id: string;
      firstName: string;
      lastName: string;
      $$meta: Meta<"users">;
      contacts: {
        type: string;
        value: string;
        $$meta: Meta<"contacts">;
        owner: {
          id: string;
          firstName: string;
          lastName: string;
          emailAddress: string;
          phoneNumber: string | null;
          address: string | null;
          $$meta: Meta<"users">;
        } | null;
      }[];
    } | null>();
  });
});

const orgs = table("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
}).meta({ __typename: "Organisation" });

const employees = table("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
}).meta({ __typename: "Employee" });

const orgRelations = relations(orgs, {
  employees: hasMany(employees, { from: [orgs.columns.id], to: [employees.columns.orgId] }),
});

const metaContext = new ExecutionContext({
  dialect: new QueryBuilder(),
  schema: new SchemaRegistry({ orgs, employees, orgRelations }),
  session: mockSession,
});

const orgClient = new ModelClient(metaContext, metaContext.schema.getTables().orgs);

describe("table().meta()", () => {
  it("adds the declared metadata to $$meta on the row", () => {
    const query = orgClient.findOne({ where: { id: { eq: "1" } }, select: { id: true } });

    expectTypeOf(query.$typeOf).toEqualTypeOf<{
      id: string;
      $$meta: { key: "orgs"; table: string; schema?: string; __typename: string };
    } | null>();
  });

  it("uses each level's own metadata, not the parent's", () => {
    const query = orgClient.findMany({
      select: { id: true },
      join: { employees: { select: { id: true } } },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<
      {
        id: string;
        // The literal alias, not `string` — it is what a row union narrows on.
        $$meta: { key: "orgs"; table: string; schema?: string; __typename: string };
        employees: {
          id: string;
          $$meta: { key: "employees"; table: string; schema?: string; __typename: string };
        }[];
      }[]
    >();
  });
});

const invoices = table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  // `notNull` with no default: without the read-only marker this would be a *required* input.
  workspaceId: uuid("workspace_id").notNull().readOnly(),
  number: text("number").notNull(),
  note: text("note"),
});

const invoiceContext = new ExecutionContext({
  dialect: new QueryBuilder(),
  schema: new SchemaRegistry({ invoices }),
  session: mockSession,
});

const invoiceClient = new ModelClient(invoiceContext, invoiceContext.schema.getTables().invoices);

describe("readOnly columns", () => {
  it("drops the field from create data, so it is not a required input", () => {
    const data = expectTypeOf(invoiceClient.create).parameter(0).toHaveProperty("data");

    data.not.toHaveProperty("workspaceId");
    data.toHaveProperty("number").toEqualTypeOf<string>();
  });

  it("drops the field from update set", () => {
    expectTypeOf(invoiceClient.update)
      .parameter(0)
      .toHaveProperty("set")
      .toEqualTypeOf<{ id?: string; number?: string; note?: string | null }>();
  });

  it("keeps the field readable, selectable and filterable", () => {
    const query = invoiceClient.findOne({
      where: { workspaceId: { eq: "ws-1" } },
      select: { id: true, workspaceId: true },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<{
      id: string;
      workspaceId: string;
      $$meta: Meta<"invoices">;
    } | null>();
  });
});

const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

const documents = ws.table("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
});

const documentContext = new ExecutionContext({
  dialect: new QueryBuilder(),
  schema: new SchemaRegistry({ documents }),
  session: mockSession,
  identity: { workspaceId: "w1" },
});

const documentClient = new ModelClient(
  documentContext,
  documentContext.schema.getTables().documents
);

describe("tenant claim columns", () => {
  // A claim column is read-only by construction, so it follows the `readOnly` rules above. What
  // is specific to it is that the caller never supplies the value at all — the client does.
  it("drops the claim from create data, so it is not a required input", () => {
    const data = expectTypeOf(documentClient.create).parameter(0).toHaveProperty("data");

    data.not.toHaveProperty("workspaceId");
    data.toHaveProperty("title").toEqualTypeOf<string>();
  });

  it("drops the claim from the update set", () => {
    expectTypeOf(documentClient.update)
      .parameter(0)
      .toHaveProperty("set")
      .toEqualTypeOf<{ id?: string; title?: string }>();
  });

  it("keeps the claim readable, selectable and filterable", () => {
    const query = documentClient.findOne({
      where: { workspaceId: { eq: "w1" } },
      select: { id: true, workspaceId: true },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<{
      id: string;
      workspaceId: string;
      $$meta: Meta<"documents">;
    } | null>();
  });
});

// A table given two `relations()` blocks, which the registry merges. The types used to see a
// union of the two maps, whose `keyof` is only the keys they share — here none — so every
// relation on `people` was `never`.
const people = table("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const notes = table("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull(),
  body: text("body").notNull(),
});

const badges = table("badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull(),
  label: text("label").notNull(),
});

const personNotes = relations(people, {
  notes: hasMany(notes, { from: [people.columns.id], to: [notes.columns.personId] }),
});

const personBadges = relations(people, {
  badges: hasMany(badges, { from: [people.columns.id], to: [badges.columns.personId] }),
});

const splitContext = new ExecutionContext({
  dialect: new QueryBuilder(),
  schema: new SchemaRegistry({ people, notes, badges, personNotes, personBadges }),
  session: mockSession,
});

const peopleClient = new ModelClient(splitContext, splitContext.schema.getTables().people);

describe("relations split across several blocks", () => {
  it("joins a relation from each block and types both results", () => {
    const query = peopleClient.findMany({
      select: { name: true },
      join: { notes: { select: { body: true } }, badges: { select: { label: true } } },
    });

    expectTypeOf(query.$typeOf).toEqualTypeOf<
      {
        name: string;
        $$meta: Meta<"people">;
        notes: { body: string; $$meta: Meta<"notes"> }[];
        badges: { label: string; $$meta: Meta<"badges"> }[];
      }[]
    >();
  });

  it("still refuses a relation neither block declares", () => {
    expectTypeOf(() => {
      // @ts-expect-error `friends` is in neither block.
      void peopleClient.findMany({ join: { friends: true } });
    }).toBeFunction();
  });
});

describe("paginate", () => {
  // Built, never awaited: the mock session answers nothing, and only the types are under test.
  const page = client.paginate({
    select: { id: true, firstName: true },
    join: { contacts: { select: { value: true } } },
    orderBy: { lastName: "asc" },
  });

  type Page = Awaited<typeof page>;
  type Item = Page["items"][number];

  it("shapes each item by select and join, like findMany", () => {
    expectTypeOf<Item["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Item["firstName"]>().toEqualTypeOf<string>();
    expectTypeOf<Item>().not.toHaveProperty("lastName");
    expectTypeOf<Item["contacts"][number]["value"]>().toEqualTypeOf<string>();
  });

  it("puts a cursor on each item's $$meta, and only on the page's own items", () => {
    expectTypeOf<Item["$$meta"]>().toEqualTypeOf<{
      key: "users";
      table: string;
      schema?: string;
      cursor: string;
    }>();
    expectTypeOf<Item["contacts"][number]["$$meta"]>().not.toHaveProperty("cursor");
  });

  it("carries the page flags and both end cursors", () => {
    expectTypeOf(page).resolves.toHaveProperty("items").toBeArray();
    expectTypeOf<Page["hasNextPage"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Page["hasPreviousPage"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Page["startCursor"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Page["endCursor"]>().toEqualTypeOf<string | null>();
  });

  it("has totalCount only when count is true", () => {
    const counted = client.paginate({ count: true });
    const uncounted = client.paginate({ count: false });
    const maybe = client.paginate({ count: Math.random() > 0.5 });

    expectTypeOf(counted).resolves.toHaveProperty("totalCount").toEqualTypeOf<number>();
    expectTypeOf(uncounted).resolves.not.toHaveProperty("totalCount");
    expectTypeOf(page).resolves.not.toHaveProperty("totalCount");
    expectTypeOf(maybe).resolves.toHaveProperty("totalCount").toEqualTypeOf<number | undefined>();
  });

  it("accepts a cursor as a GraphQL argument arrives: string, null or absent", () => {
    const argument = null as string | null | undefined;

    // Compiling is the assertion; with no cursor, these only build a query.
    expectTypeOf(client.paginate({ after: argument })).toHaveProperty("then");
    expectTypeOf(client.paginate({ before: argument })).toHaveProperty("then");
  });

  // Rejected calls sit in arrows that are never invoked, so this file's runtime pass skips them.
  it("does not accept distinct or offset", () => {
    expectTypeOf(() => {
      // @ts-expect-error a keyset page has no offset.
      void client.paginate({ offset: 10 });
      // @ts-expect-error nor distinct, which would collapse rows the keyset relies on.
      void client.paginate({ distinct: true });
    }).toBeFunction();
  });

  it("does not accept a field the table does not have", () => {
    expectTypeOf(() => {
      // @ts-expect-error `title` is not a users field.
      void client.paginate({ orderBy: { title: "asc" } });
    }).toBeFunction();
  });
});

describe("count", () => {
  it("resolves to a number", () => {
    expectTypeOf(client.count({ where: { lastName: "Doe" } })).toEqualTypeOf<
      ExecutableQuery<number>
    >();
  });

  it("does not accept a field the table does not have", () => {
    expectTypeOf(() => {
      // @ts-expect-error `title` is not a users field.
      void client.count({ where: { title: "x" } });
    }).toBeFunction();
  });
});

describe("selection", () => {
  const users = table("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
  });

  const posts = table("posts", {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
  });

  const comments = table("comments", {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull(),
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
  });

  const tasks = table("tasks", {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
  });

  const photos = table("photos", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    createdAt: datetime("created_at").notNull(),
    photoUrl: text("photo_url").notNull(),
  });

  const videos = table("videos", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("owner_id").notNull(),
    createdAt: datetime("created_at").notNull(),
    videoUrl: text("video_url").notNull(),
  });

  const media = union({ photos, videos });

  const userRelations = relations(users, {
    posts: hasMany(posts, { from: [users.columns.id], to: [posts.columns.authorId] }),
    feed: hasMany(media, { from: [users.columns.id], to: [media.columns.userId] }),
  });

  const postRelations = relations(posts, {
    author: belongsTo(users, { from: [posts.columns.authorId], to: [users.columns.id] }),
    comments: hasMany(comments, { from: [posts.columns.id], to: [comments.columns.postId] }),
  });

  const commentRelations = relations(comments, {
    author: belongsTo(users, { from: [comments.columns.authorId], to: [users.columns.id] }),
  });

  const taskRelations = relations(tasks, {
    parent: belongsTo(tasks, { from: [tasks.columns.parentId], to: [tasks.columns.id] }),
    children: hasMany(tasks, { from: [tasks.columns.id], to: [tasks.columns.parentId] }),
  });

  const schema = {
    users,
    posts,
    comments,
    tasks,
    photos,
    videos,
    media,
    userRelations,
    postRelations,
    commentRelations,
    taskRelations,
  };

  const session = { execute: vi.fn(async () => []) } as unknown as Session;
  const dsql = createClient({ schema, session });

  const where = { id: { eq: "p1" } };

  type Meta<K extends string> = { key: K; table: string; schema?: string };

  describe("which columns a select returns", () => {
    it("returns every column with no select", () => {
      expectTypeOf(dsql.posts.findOne({ where }).$typeOf).toEqualTypeOf<{
        id: string;
        authorId: string;
        title: string;
        subtitle: string | null;
        $$meta: Meta<"posts">;
      } | null>();
    });

    it("returns every column when select names nothing, as the runtime does", () => {
      const none = dsql.posts.findOne({ where }).$typeOf;

      expectTypeOf(dsql.posts.findOne({ where, select: {} }).$typeOf).toEqualTypeOf(none);
      expectTypeOf(
        dsql.posts.findOne({ where, select: { id: false, title: false } }).$typeOf
      ).toEqualTypeOf(none);
    });

    it("returns only the relations when select names only relations", () => {
      expectTypeOf(dsql.posts.findOne({ where, select: { author: true } }).$typeOf).toEqualTypeOf<{
        $$meta: Meta<"posts">;
        author: { id: string; name: string; $$meta: Meta<"users"> } | null;
      } | null>();
    });

    it("returns every column on a write's return that names nothing", () => {
      expectTypeOf(
        dsql.posts.create({ data: { authorId: "u", title: "t" }, return: {} }).$typeOf
      ).toEqualTypeOf<{
        id: string;
        authorId: string;
        title: string;
        subtitle: string | null;
        $$meta: Meta<"posts">;
      } | null>();
    });
  });

  describe("a relation in select", () => {
    it("is typed as the join form", () => {
      const selected = dsql.posts.findMany({
        select: { title: true, author: { name: true }, comments: true },
      }).$typeOf;
      const joined = dsql.posts.findMany({
        select: { title: true },
        join: { author: { select: { name: true } }, comments: true },
      }).$typeOf;

      expectTypeOf(selected).toEqualTypeOf(joined);
    });

    it("nests a relation inside a relation's field map", () => {
      const query = dsql.posts.findMany({
        select: { comments: { body: true, author: { name: true } } },
      });

      expectTypeOf(query.$typeOf).items.toHaveProperty("comments").toEqualTypeOf<
        {
          body: string;
          $$meta: Meta<"comments">;
          author: { name: string; $$meta: Meta<"users"> } | null;
        }[]
      >();
    });

    it("follows a self-referential relation", async () => {
      const task = await dsql.tasks.findOne({
        where: { id: { eq: "t1" } },
        select: { title: true, parent: { title: true, parent: { id: true } }, children: true },
      });

      expectTypeOf(task?.parent?.parent?.id).toEqualTypeOf<string | undefined>();
      expectTypeOf(task?.children[0]?.parentId).toEqualTypeOf<string | null | undefined>();
    });

    it("takes a union's shared fields", async () => {
      const user = await dsql.users.findOne({
        where: { id: { eq: "u1" } },
        select: { feed: { id: true, createdAt: true } },
      });
      const post = user?.feed[0];

      expectTypeOf(post?.$$key).toEqualTypeOf<"photos" | "videos" | undefined>();
      expectTypeOf(post?.createdAt).toEqualTypeOf<Date | undefined>();
      expectTypeOf(user).not.toHaveProperty("name");
    });

    it("carries through a page's items", async () => {
      const page = await dsql.posts.paginate({ select: { title: true, author: { name: true } } });

      expectTypeOf(page.items).items.toHaveProperty("author").toEqualTypeOf<{
        name: string;
        $$meta: Meta<"users">;
      } | null>();
    });

    // Type-checked only: the invalid calls would also throw at runtime.
    it("refuses what belongs in join, and what is not a field", () => {
      const check = () => {
        dsql.posts.findMany({
          select: { author: true },
          // @ts-expect-error `author` is already in select
          join: { author: true },
        });

        dsql.users.findMany({
          // @ts-expect-error query args are written in join, not in select
          select: { posts: { where: { title: "x" } } },
        });

        dsql.users.findMany({
          // @ts-expect-error `photoUrl` is not shared by every member of the union
          select: { feed: { photoUrl: true } },
        });

        dsql.posts.findMany({
          // @ts-expect-error `editor` is neither a column nor a relation of posts
          select: { editor: true },
        });

        dsql.posts.create({
          data: { authorId: "u", title: "t" },
          // @ts-expect-error a write's return has no relations
          return: { author: true },
        });

        // A falsy join entry beside the selected relation is not an overlap.
        dsql.posts.findMany({ select: { author: true }, join: { author: false } });
      };

      expectTypeOf(check).toBeFunction();
    });
  });
});

describe("JSON columns", () => {
  type SettingsIn = { theme?: "light" | "dark"; since: string | Date };
  type SettingsOut = { theme: "light" | "dark"; since: Date };

  // Typed only: these tests never validate a value.
  const settings = {} as StandardSchemaV1<SettingsIn, SettingsOut>;

  const users = table("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    settings: jsonb("settings").schema(settings).notNull(),
    profile: jsonb("profile").schema(settings),
    tags: jsonb("tags").$type<string[]>(),
    legacy: json("legacy"),
  });

  const session = { execute: vi.fn(async () => []) } as unknown as Session;
  const dsql = createClient({ schema: { users }, session });

  describe("a JSON column's types", () => {
    it("reads the schema's output", async () => {
      const user = await dsql.users.findOne({ where: { id: "u1" } });

      expectTypeOf(user?.settings).toEqualTypeOf<SettingsOut | undefined>();
      expectTypeOf(user?.profile).toEqualTypeOf<SettingsOut | null | undefined>();
    });

    it("writes the schema's input", () => {
      const check = () => {
        dsql.users.create({ data: { settings: { since: "2026-10-01" } } });
        dsql.users.update({ where: { id: "u1" }, set: { profile: null } });

        // @ts-expect-error `since` is required by the schema's input
        dsql.users.create({ data: { settings: {} } });

        // @ts-expect-error the column is not null
        dsql.users.update({ where: { id: "u1" }, set: { settings: null } });
      };

      expectTypeOf(check).toBeFunction();
    });

    it("reads and writes one type with $type, and unknown with neither", async () => {
      const user = await dsql.users.findOne({ where: { id: "u1" } });

      expectTypeOf(user?.tags).toEqualTypeOf<string[] | null | undefined>();
      expectTypeOf(user?.legacy).toEqualTypeOf<unknown>();
    });

    it("takes the schema's input as a default", () => {
      expectTypeOf(jsonb("s").schema(settings).default).parameter(0).toEqualTypeOf<SettingsIn>();
    });
  });
});

describe("array and record columns", () => {
  type Panel = { id: number; open: boolean };
  type Limits = { cpu: number; memory?: number };

  // Typed only: these tests never validate a value.
  const labels = {} as StandardSchemaV1<string[], string[]>;
  const quotas = {} as StandardSchemaV1<Record<string, number>>;
  const text = {} as StandardSchemaV1<string>;

  const boards = table("boards", {
    id: uuid("id").primaryKey().defaultRandom(),
    tags: array("tags").$type<string>().notNull(),
    aliases: array("aliases").$type<string[]>(),
    grid: array("grid").$type<number[][]>(),
    panels: array("panels").$type<Panel>(),
    labels: array("labels").schema(labels),
    anything: array("anything"),
    limits: record("limits").$type<Limits>(),
    quotas: record("quotas").schema(quotas),
    meta: record("meta"),
  });

  const schema = { boards };
  const session = { execute: vi.fn(async () => []) } as unknown as Session;
  const dsql = createClient({ schema, session });

  describe("array() and record() types", () => {
    it("reads $type as the item type or the array type, and an untyped array as unknown[]", async () => {
      const board = await dsql.boards.findOne({ where: { id: "b1" } });

      expectTypeOf(board?.tags).toEqualTypeOf<string[] | undefined>();
      expectTypeOf(board?.aliases).toEqualTypeOf<string[] | null | undefined>();
      expectTypeOf(board?.grid).toEqualTypeOf<number[][] | null | undefined>();
      expectTypeOf(board?.panels).toEqualTypeOf<Panel[] | null | undefined>();
      expectTypeOf(board?.labels).toEqualTypeOf<string[] | null | undefined>();
      expectTypeOf(board?.anything).toEqualTypeOf<unknown[] | null | undefined>();
    });

    it("reads a record's $type exactly as given, and an untyped record as Record<string, unknown>", async () => {
      const board = await dsql.boards.findOne({ where: { id: "b1" } });

      expectTypeOf(board?.limits).toEqualTypeOf<Limits | null | undefined>();
      expectTypeOf(board?.quotas).toEqualTypeOf<Record<string, number> | null | undefined>();
      expectTypeOf(board?.meta).toEqualTypeOf<Record<string, unknown> | null | undefined>();
    });

    it("takes only a schema of the column's shape", () => {
      const check = () => {
        // @ts-expect-error an array column takes a schema whose output is an array
        array("a").schema(text);

        // @ts-expect-error a record column takes a schema whose output is an object
        record("r").schema(text);

        array("a").schema(labels);
        record("r").schema(quotas);
      };

      expectTypeOf(check).toBeFunction();
    });
  });
});

describe("column groups", () => {
  const money = embedded({
    amount: bigint("amount").notNull(),
    currency: text("currency").notNull(),
  });
  const geo = embedded({ lat: text("lat"), lng: text("lng") });
  const address = embedded({ city: text("city"), geo: geo.column("geo") });

  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    netValue: money.column("net_value"),
    billing: address.column("billing"),
  });

  const session = { execute: vi.fn(async () => []) } as unknown as Session;
  const dsql = createClient({ schema: { invoices }, session });

  type NetValue = { amount: bigint; currency: string };
  type Billing = { city: string | null; geo: { lat: string | null; lng: string | null } | null };

  describe("a group's read types", () => {
    it("reads a group as an object, null too when every member is nullable", async () => {
      const invoice = await dsql.invoices.findOne({ where: { id: "i1" } });

      expectTypeOf(invoice?.netValue).toEqualTypeOf<NetValue | undefined>();
      expectTypeOf(invoice?.billing).toEqualTypeOf<Billing | null | undefined>();
    });

    it("reads a group selected as true whole, and a member map as those members", async () => {
      const invoice = await dsql.invoices.findOne({
        where: { id: "i1" },
        select: { netValue: true, billing: { geo: { lat: true } } },
      });

      expectTypeOf(invoice).toEqualTypeOf<{
        netValue: NetValue;
        billing: { geo: { lat: string | null } | null } | null;
        $$meta: Meta<"invoices">;
      } | null>();
    });

    it("reads a group in a write's return", () => {
      const query = dsql.invoices.delete({
        where: { id: "i1" },
        return: { netValue: { amount: true } },
      });

      expectTypeOf(query.$typeOf).toEqualTypeOf<{
        netValue: { amount: bigint };
        $$meta: Meta<"invoices">;
      } | null>();
    });

    it("refuses a member the group does not have, and a map on a column", () => {
      const check = () => {
        // @ts-expect-error `nope` is not a member of `netValue`
        dsql.invoices.findMany({ select: { netValue: { nope: true } } });

        // @ts-expect-error a column takes true, not a map
        dsql.invoices.findMany({ select: { id: { x: true } } });
      };

      expectTypeOf(check).toBeFunction();
    });
  });

  describe("a group's write types", () => {
    const priced = embedded({
      amount: bigint("amount").notNull(),
      currency: text("currency").notNull().default("EUR"),
      stamp: text("stamp").readOnly(),
    });

    const orders = table("orders", {
      id: uuid("id").primaryKey().defaultRandom(),
      price: priced.column("price"),
      shipping: address.column("shipping"),
      fallback: priced.column("fallback").default({ amount: 0n }),
    });

    const dsql = createClient({ schema: { orders }, session });

    type Create = Parameters<typeof dsql.orders.create>[0]["data"];
    type Update = Parameters<typeof dsql.orders.update>[0]["set"];

    // A read-only member is left out of both, as a read-only column is.
    it("requires a group with a required member, takes the rest optional", () => {
      expectTypeOf<Create["price"]>().toEqualTypeOf<{ amount: bigint; currency?: string }>();
      expectTypeOf<Create["shipping"]>().toEqualTypeOf<
        | {
            city?: string | null;
            geo?: { lat?: string | null; lng?: string | null } | null;
          }
        | null
        | undefined
      >();
      expectTypeOf<Create["fallback"]>().toEqualTypeOf<
        { amount: bigint; currency?: string } | undefined
      >();

      const check = () => {
        dsql.orders.create({ data: { price: { amount: 1n } } });

        // @ts-expect-error `price` has a required member and no default
        dsql.orders.create({ data: {} });

        // @ts-expect-error `amount` is required within it
        dsql.orders.create({ data: { price: { currency: "EUR" } } });
      };

      expectTypeOf(check).toBeFunction();
    });

    it("updates any members, and null only a group whose members are all nullable", () => {
      expectTypeOf<Update["price"]>().toEqualTypeOf<
        { amount?: bigint; currency?: string } | undefined
      >();

      const check = () => {
        dsql.orders.update({ where: { id: "o1" }, set: { shipping: { geo: { lat: "1" } } } });
        dsql.orders.update({ where: { id: "o1" }, set: { shipping: null } });

        // @ts-expect-error `price` has a member that is not null
        dsql.orders.update({ where: { id: "o1" }, set: { price: null } });
      };

      expectTypeOf(check).toBeFunction();
    });
  });
});
