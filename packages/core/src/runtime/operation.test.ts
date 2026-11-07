import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
  defineSettings,
} from "../definition/index.js";
import { sql, SQLIdentifier, SQLNode, SQLParam, SQLQuery } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { FieldMutation, OperationsFactory } from "./operation.js";
import { SchemaRegistry } from "./registry.js";
import { QueryBuilder, TableJoinParams } from "./query.js";
import type { AnyTable } from "./table.js";

const users = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    name: new ColumnDefinition("name").notNull(),
    email: new ColumnDefinition("email").unique(),
  },
});

const posts = new TableDefinition("posts", {
  columns: {
    id: new ColumnDefinition("id").primaryKey(),
    title: new ColumnDefinition("title").notNull(),
    content: new ColumnDefinition("content"),
    publishedAt: new ColumnDefinition("published_at"),
    authorId: new ColumnDefinition("author_id").notNull(),
  },
});

const usersRelations = new RelationsDefinition(users, {
  posts: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.authorId],
  },
});

const registry = new SchemaRegistry({ users, posts, usersRelations });

const mockDialect = vi.mockObject(new QueryBuilder());

const mockSession = {
  execute: vi.fn(),
};

describe("OperationFactory", () => {
  let context: ExecutionContext;
  let factory: OperationsFactory;

  beforeAll(() => {
    context = new ExecutionContext({
      schema: registry,
      dialect: mockDialect,
      session: mockSession,
    });

    factory = new OperationsFactory(context);
  });

  it("should create an insert operation", () => {
    mockDialect.buildInsertQuery.mockReturnValue(sql`INSERT`);
    const users = registry.getTable("users");

    const { query } = factory.createInsertOperation(users, {
      name: "insert_user",
      mode: "one",
      args: {
        data: [
          [
            ["id", new SQLParam(1)],
            ["name", new SQLParam("Alice")],
          ],
        ],
        return: [["id", users.columns.id]],
      },
    });

    expect(mockDialect.buildInsertQuery).toHaveBeenCalledWith({
      table: users,
      columns: expect.arrayContaining([
        expect.objectContaining({ name: "id" }),
        expect.objectContaining({ name: "name" }),
        expect.objectContaining({ name: "email" }),
      ]),
      values: expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ _value: 1 }),
          expect.objectContaining({ _value: "Alice" }),
          expect.objectContaining({ _text: "DEFAULT" }),
        ]),
      ]),
      return: [users.columns.id],
    });

    expect(query.text).toBe("INSERT");
  });

  it("should resolve insert operation results", () => {
    mockDialect.buildInsertQuery.mockReturnValue(sql`INSERT`);

    const users = registry.getTable("users");

    const operation = factory.createInsertOperation(users, {
      name: "insert_user",
      mode: "one",
      args: {
        data: [
          [
            ["id", new SQLParam(1)],
            ["name", new SQLParam("Alice")],
            ["email", new SQLParam(null)],
          ],
        ],
        return: [["id", users.columns.id]],
      },
    });

    const result = operation.resolve([{ id: 1 }]);
    expect(result).toEqual({ id: 1, $$meta: { key: "users", table: "users" } });
  });

  it("should create a select operation", () => {
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    const users = registry.getTable("users");
    const whereClause = sql`${users.columns.name} = ${sql.param("Alice")}`;

    const { query } = factory.createSelectOperation(users, {
      name: "select_user",
      mode: "one",
      args: {
        select: [["id", users.columns.id]],
        where: whereClause,
      },
    });

    expect(mockDialect.buildSelectQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        table: users,
        select: [users.columns.id],
        where: whereClause,
        limit: 1,
      })
    );

    expect(query.text).toBe("SELECT");
  });

  it("should resolve select operation results", () => {
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    const users = registry.getTable("users");

    const operation = factory.createSelectOperation(users, {
      name: "select_user",
      mode: "one",
      args: {
        select: [
          ["id", users.columns.id],
          ["name", users.columns.name],
        ],
        where: sql`${users.columns.name} = ${sql.param("Alice")}`,
      },
    });

    const result = operation.resolve([{ id: 1, name: "Alice" }]);
    expect(result).toEqual({ id: 1, name: "Alice", $$meta: { key: "users", table: "users" } });
  });

  it("should resolve many select operation results", () => {
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    const users = registry.getTable("users");

    const operation = factory.createSelectOperation(users, {
      name: "select_users",
      mode: "many",
      args: {
        select: [
          ["id", users.columns.id],
          ["name", users.columns.name],
        ],
        where: sql`${users.columns.name} LIKE ${sql.param("A%")}`,
      },
    });

    const result = operation.resolve([
      { id: 1, name: "Alice" },
      { id: 2, name: "Alex" },
    ]);

    expect(result).toEqual([
      { id: 1, name: "Alice", $$meta: { key: "users", table: "users" } },
      { id: 2, name: "Alex", $$meta: { key: "users", table: "users" } },
    ]);
  });

  it("should create an update operation", () => {
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    const users = registry.getTable("users");

    const { query } = factory.createUpdateOperation(users, {
      name: "update_user",
      mode: "one",
      args: {
        set: [
          ["name", sql.param("Alice Updated")],
          ["email", sql.param("other@email.com")],
        ],
        where: sql`${users.columns.id} = ${sql.param(1)}`,
        return: [["id", users.columns.id]],
      },
    });

    expect(mockDialect.buildUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        table: users,
        set: [
          [
            expect.objectContaining({ name: "name" }),
            expect.objectContaining({ _value: "Alice Updated" }),
          ],
          [
            expect.objectContaining({ name: "email" }),
            expect.objectContaining({ _value: "other@email.com" }),
          ],
        ],
        where: expect.objectContaining({}),
        return: [users.columns.id],
      })
    );

    expect(query.text).toBe("UPDATE");
  });

  it("should resolve update operation results", () => {
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    const users = registry.getTable("users");

    const operation = factory.createUpdateOperation(users, {
      name: "update_user",
      mode: "one",
      args: {
        set: [
          ["name", sql.param("Alice Updated")],
          ["email", sql.param("other@email.com")],
        ],
        where: sql`${users.columns.id} = ${sql.param(1)}`,
        return: [["id", users.columns.id]],
      },
    });

    const result = operation.resolve([{ id: 1 }]);
    expect(result).toEqual({ id: 1, $$meta: { key: "users", table: "users" } });
  });
});

describe("OperationFactory / $$meta", () => {
  let factory: OperationsFactory;

  beforeAll(() => {
    factory = new OperationsFactory(
      new ExecutionContext({ schema: registry, dialect: mockDialect, session: mockSession })
    );

    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    mockDialect.buildDeleteQuery.mockReturnValue(sql`DELETE`);
  });

  const selectUsers = (args: Parameters<typeof factory.createSelectOperation>[1]["args"]) =>
    factory.createSelectOperation(registry.getTable("users"), { mode: "many", args });

  it("stamps $$meta on rows of a joined level, not only the top level", () => {
    const users = registry.getTable("users");
    const operation = selectUsers({
      select: [["id", users.columns.id]],
      join: [["posts", { select: [["title", registry.getTable("posts").columns.title]] }]],
    });

    const [row] = operation.resolve([
      { id: 1, posts: [{ title: "First" }, { title: "Second" }] },
    ]) as Record<string, { $$meta: unknown }[]>[];

    expect(row.posts?.[0]?.$$meta).toEqual({ key: "posts", table: "posts" });
    expect(row.posts?.[1]?.$$meta).toEqual({ key: "posts", table: "posts" });
  });

  it("reports the joined level's own table, not the parent's", () => {
    const users = registry.getTable("users");
    const operation = selectUsers({
      select: [["id", users.columns.id]],
      join: [["posts", { select: [["title", registry.getTable("posts").columns.title]] }]],
    });

    const [row] = operation.resolve([{ id: 1, posts: [{ title: "First" }] }]) as Record<
      string,
      unknown
    >[];

    expect((row.$$meta as { key: string }).key).toBe("users");
    expect((row.posts as { $$meta: { key: string } }[])[0]?.$$meta.key).toBe("posts");
  });

  it("shares one frozen object across every row of a level", () => {
    const users = registry.getTable("users");
    const rows = selectUsers({ select: [["id", users.columns.id]] }).resolve([
      { id: 1 },
      { id: 2 },
    ]) as { $$meta: object }[];

    expect(rows[0]?.$$meta).toBe(rows[1]?.$$meta);
    expect(rows[0]?.$$meta).toBe(users.meta);
    expect(Object.isFrozen(rows[0]?.$$meta)).toBe(true);
  });

  it("leaves an absent join null rather than stamping meta on it", () => {
    const users = registry.getTable("users");
    const operation = selectUsers({
      select: [["id", users.columns.id]],
      join: [["posts", { select: [["title", registry.getTable("posts").columns.title]] }]],
    });

    const [row] = operation.resolve([{ id: 1, posts: null }]) as Record<string, unknown>[];

    expect(row.posts).toBeNull();
  });

  it("leads every record, so $$meta is the first key", () => {
    const users = registry.getTable("users");
    const [row] = selectUsers({
      select: [
        ["id", users.columns.id],
        ["name", users.columns.name],
      ],
    }).resolve([{ id: 1, name: "Alice" }]) as object[];

    expect(Object.keys(row)).toEqual(["$$meta", "id", "name"]);
  });

  it("stamps $$meta on `return` rows of a mutation", () => {
    const users = registry.getTable("users");
    const operation = factory.createDeleteOperation(users, {
      mode: "one",
      args: {
        where: sql`${users.columns.id} = ${sql.param(1)}`,
        return: [["id", users.columns.id]],
      },
    });

    expect(operation.resolve([{ id: 1 }])).toEqual({
      id: 1,
      $$meta: { key: "users", table: "users" },
    });
  });
});

describe("OperationFactory / selection", () => {
  const factory = new OperationsFactory(
    new ExecutionContext({ schema: registry, dialect: new QueryBuilder(), session: mockSession })
  );
  const users = registry.getTable("users");

  it("projects every column when the selection is omitted", () => {
    const { query } = factory.createSelectOperation(users, { mode: "many", args: {} });

    expect(query.text).toBe(
      'SELECT "__t0"."id", "__t0"."name", "__t0"."email" FROM "users" AS "__t0"'
    );
  });

  it("projects no column when the selection is empty, leaving only the joins", () => {
    const { query, resolve } = factory.createSelectOperation(users, {
      mode: "many",
      args: {
        select: [],
        join: [["posts", { select: [["title", registry.getTable("posts").columns.title]] }]],
      },
    });

    expect(query.text).toMatch(/^SELECT "__join_posts"\."data" AS "posts" FROM "users" AS "__t0"/);
    expect(resolve([{ posts: [{ title: "First" }] }])).toEqual([
      {
        $$meta: { key: "users", table: "users" },
        posts: [{ $$meta: { key: "posts", table: "posts" }, title: "First" }],
      },
    ]);
  });
});

describe("OperationFactory / where seam", () => {
  let factory: OperationsFactory;

  beforeAll(() => {
    factory = new OperationsFactory(
      new ExecutionContext({ schema: registry, dialect: mockDialect, session: mockSession })
    );

    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    mockDialect.buildDeleteQuery.mockReturnValue(sql`DELETE`);
  });

  const renderLastWhere = (spy: { mock: { calls: { where?: SQLNode }[][] } }) => {
    const where = spy.mock.calls.at(-1)?.[0]?.where;
    return where ? new SQLQuery(where).toQuery().text : undefined;
  };

  it("produces no WHERE when the caller passed none", () => {
    const users = registry.getTable("users");

    factory.createSelectOperation(users, {
      mode: "many",
      args: { select: [["id", users.columns.id]] },
    });

    expect(mockDialect.buildSelectQuery).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it("leaves a single condition untouched, so no parentheses are added", () => {
    const users = registry.getTable("users");
    const where = sql`${users.columns.name} = ${sql.param("Alice")}`;

    factory.createSelectOperation(users, {
      mode: "many",
      args: { select: [["id", users.columns.id]], where },
    });

    expect(mockDialect.buildSelectQuery).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(renderLastWhere(mockDialect.buildSelectQuery)).toBe(`"users"."name" = $1`);
  });

  it("AND-s an array of conditions instead of keeping only the first", () => {
    const users = registry.getTable("users");

    factory.createSelectOperation(users, {
      mode: "many",
      args: {
        select: [["id", users.columns.id]],
        where: [
          sql`${users.columns.name} = ${sql.param("Alice")}`,
          sql`${users.columns.email} = ${sql.param("a@example.com")}`,
        ],
      },
    });

    expect(renderLastWhere(mockDialect.buildSelectQuery)).toBe(
      `("users"."name" = $1) AND ("users"."email" = $2)`
    );
  });

  it("wraps each condition, so an OR among them keeps its precedence", () => {
    const users = registry.getTable("users");

    factory.createSelectOperation(users, {
      mode: "many",
      args: {
        select: [["id", users.columns.id]],
        where: [
          sql`${users.columns.id} = ${sql.param(1)}`,
          sql.or([
            sql`${users.columns.name} = ${sql.param("Alice")}`,
            sql`${users.columns.name} = ${sql.param("Alex")}`,
          ]),
        ],
      },
    });

    expect(renderLastWhere(mockDialect.buildSelectQuery)).toBe(
      `("users"."id" = $1) AND ("users"."name" = $2 OR "users"."name" = $3)`
    );
  });

  it("treats an empty array as no WHERE at all", () => {
    const users = registry.getTable("users");

    factory.createSelectOperation(users, {
      mode: "many",
      args: { select: [["id", users.columns.id]], where: [] },
    });

    expect(mockDialect.buildSelectQuery).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it("runs for every nested join level, not only the root", () => {
    const users = registry.getTable("users");
    const posts = registry.getTable("posts");

    factory.createSelectOperation(users, {
      mode: "many",
      args: {
        select: [["id", users.columns.id]],
        join: [
          [
            "posts",
            {
              select: [["title", posts.columns.title]],
              where: [
                sql`${posts.columns.title} = ${sql.param("First")}`,
                sql`${posts.columns.content} = ${sql.param("body")}`,
              ],
            },
          ],
        ],
      },
    });

    const join = mockDialect.buildSelectQuery.mock.calls.at(-1)?.[0]?.join;
    const nested = (join?.[0] as TableJoinParams | undefined)?.params.where;

    expect(nested && new SQLQuery(nested).toQuery().text).toBe(
      `("posts"."title" = $1) AND ("posts"."content" = $2)`
    );
  });

  it("builds an update and a delete with no WHERE", () => {
    const users = registry.getTable("users");

    factory.createUpdateOperation(users, {
      mode: "many",
      args: { set: [["name", new SQLParam("Alice")]] },
    });

    expect(mockDialect.buildUpdateQuery).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );

    factory.createDeleteOperation(users, { mode: "many", args: {} });

    expect(mockDialect.buildDeleteQuery).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it("AND-s an array on update and delete too", () => {
    const users = registry.getTable("users");
    const where = [
      sql`${users.columns.id} = ${sql.param(1)}`,
      sql`${users.columns.name} = ${sql.param("Alice")}`,
    ];

    factory.createUpdateOperation(users, {
      mode: "many",
      args: { set: [["name", new SQLParam("Alex")]], where },
    });

    expect(renderLastWhere(mockDialect.buildUpdateQuery)).toBe(
      `("users"."id" = $1) AND ("users"."name" = $2)`
    );

    factory.createDeleteOperation(users, { mode: "many", args: { where } });

    expect(renderLastWhere(mockDialect.buildDeleteQuery)).toBe(
      `("users"."id" = $1) AND ("users"."name" = $2)`
    );
  });
});

describe("OperationFactory / read-only columns", () => {
  const managed = new TableDefinition("managed", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      tenantId: new ColumnDefinition("tenant_id").notNull().readOnly(),
      name: new ColumnDefinition("name").notNull(),
    },
  });

  const managedRegistry = new SchemaRegistry({ managed });

  let factory: OperationsFactory;

  beforeAll(() => {
    factory = new OperationsFactory(
      new ExecutionContext({ schema: managedRegistry, dialect: mockDialect, session: mockSession })
    );

    mockDialect.buildInsertQuery.mockReturnValue(sql`INSERT`);
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
  });

  it("refuses an insert that carries a value for a read-only column", () => {
    const table = managedRegistry.getTable("managed");

    expect(() =>
      factory.createInsertOperation(table, {
        mode: "one",
        args: {
          data: [
            [
              ["id", new SQLParam(1)],
              ["tenantId", new SQLParam("ws-1")],
              ["name", new SQLParam("Alice")],
            ],
          ],
        },
      })
    ).toThrow(`Cannot write read-only column "tenantId"`);
  });

  it("allows an insert that leaves the read-only column alone", () => {
    const table = managedRegistry.getTable("managed");

    expect(() =>
      factory.createInsertOperation(table, {
        mode: "one",
        args: {
          data: [
            [
              ["id", new SQLParam(1)],
              ["name", new SQLParam("Alice")],
            ],
          ],
        },
      })
    ).not.toThrow();
  });

  it("refuses an update that sets a read-only column", () => {
    const table = managedRegistry.getTable("managed");

    expect(() =>
      factory.createUpdateOperation(table, {
        mode: "many",
        args: { set: [["tenantId", new SQLParam("ws-2")]] },
      })
    ).toThrow(`Cannot write read-only column "tenantId"`);
  });

  it("keeps a read-only column readable", () => {
    const table = managedRegistry.getTable("managed");

    const operation = factory.createSelectOperation(table, {
      mode: "one",
      args: {
        select: [
          ["id", table.columns.id],
          ["tenantId", table.columns.tenantId],
        ],
      },
    });

    expect(operation.resolve([{ id: 1, tenant_id: "ws-1" }])).toEqual({
      id: 1,
      tenantId: "ws-1",
      $$meta: { key: "managed", table: "managed" },
    });
  });
});

describe("OperationFactory / keyset keys", () => {
  // A real builder, so the hidden projections are checked as rendered — aliased with the rest
  // of their level.
  const factory = new OperationsFactory(
    new ExecutionContext({ schema: registry, dialect: new QueryBuilder(), session: mockSession })
  );

  it("projects each key again as text under a hidden name, after the selected fields", () => {
    const posts = registry.getTable("posts");

    const operation = factory.createSelectOperation(posts, {
      mode: "many",
      args: {
        select: [["title", posts.columns.title]],
        keys: [posts.columns.publishedAt, posts.columns.id],
      },
    });

    expect(operation.query.text).toBe(
      `SELECT "__t0"."title", "__t0"."published_at"::text AS "__k0", "__t0"."id"::text AS "__k1" ` +
        `FROM "posts" AS "__t0"`
    );
  });

  it("keeps the hidden keys off the resolved record", () => {
    const posts = registry.getTable("posts");

    const operation = factory.createSelectOperation(posts, {
      mode: "many",
      args: { select: [["title", posts.columns.title]], keys: [posts.columns.id] },
    });

    const [record] = operation.resolve([{ title: "Hello", __k0: "p1" }]) as object[];

    expect(record).not.toHaveProperty("__k0");
    expect(record).toHaveProperty("title", "Hello");
  });

  it("refuses keys on a join level", () => {
    const users = registry.getTable("users");
    const posts = registry.getTable("posts");

    expect(() =>
      factory.createSelectOperation(users, {
        mode: "many",
        args: {
          select: [["id", users.columns.id]],
          join: [["posts", { select: [["id", posts.columns.id]], keys: [posts.columns.id] }]],
        },
      })
    ).toThrow(/only the root level of a select is keyset-ordered/);
  });
});

describe("OperationFactory / count", () => {
  const factory = new OperationsFactory(
    new ExecutionContext({ schema: registry, dialect: new QueryBuilder(), session: mockSession })
  );

  it("counts the rows the where selects", () => {
    const users = registry.getTable("users");

    const operation = factory.createCountOperation(users, {
      mode: "one",
      args: { where: sql`${users.columns.name} = ${sql.param("Alice")}` },
    });

    expect(operation.query.text).toBe(
      `SELECT count(*) AS "count" FROM "users" AS "__t0" WHERE "__t0"."name" = $1`
    );
    expect(operation.query.params).toEqual(["Alice"]);
  });

  it("counts every row when there is no where", () => {
    const users = registry.getTable("users");

    const operation = factory.createCountOperation(users, { mode: "one", args: {} });

    expect(operation.query.text).toBe(`SELECT count(*) AS "count" FROM "users" AS "__t0"`);
  });

  it("resolves the driver's bigint, as text or as bigint, to a number", () => {
    const users = registry.getTable("users");
    const operation = factory.createCountOperation(users, { mode: "one", args: {} });

    expect(operation.resolve([{ count: "42" }])).toBe(42);
    expect(operation.resolve([{ count: 42n }])).toBe(42);
  });
});

describe("OperationFactory / $onUpdate", () => {
  const articles = new TableDefinition("articles", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      title: new ColumnDefinition("title"),
      revision: new ColumnDefinition("revision").$onUpdate(() => "next"),
      updatedAt: new ColumnDefinition("updated_at").readOnly().$onUpdate(() => "now"),
    },
  });

  const hooks = new SchemaRegistry({ articles });
  let factory: OperationsFactory;

  beforeAll(() => {
    factory = new OperationsFactory(
      new ExecutionContext({ schema: hooks, dialect: mockDialect, session: mockSession })
    );
  });

  const update = (set: FieldMutation[]) => {
    mockDialect.buildUpdateQuery.mockClear();
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    factory.createUpdateOperation(hooks.getTable("articles"), { mode: "many", args: { set } });

    const [params] = mockDialect.buildUpdateQuery.mock.lastCall ?? [];

    return (params?.set ?? []).map(([column, value]) => [
      (column as SQLIdentifier).name,
      (value as SQLParam<unknown>)["_value"],
    ]);
  };

  it("runs on every update, for columns the update does not name", () => {
    expect(update([["title", sql.param("Draft")]])).toEqual([
      ["title", "Draft"],
      ["revision", "next"],
      ["updated_at", "now"],
    ]);
  });

  it("gives way to a value the update names", () => {
    expect(update([["revision", sql.param("pinned")]])).toEqual([
      ["revision", "pinned"],
      ["updated_at", "now"],
    ]);
  });
});

describe("OperationFactory / settings", () => {
  const params = defineSettings({ workspaceId: new ColumnDefinition("identity.workspace_id") });

  const docs = new TableDefinition("docs", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      workspaceId: new ColumnDefinition("workspace_id")
        .notNull()
        .readOnly()
        .$onCreate(() => params.workspaceId),
      title: new ColumnDefinition("title").notNull(),
    },
  });

  const docsRegistry = new SchemaRegistry({ docs });
  const table = docsRegistry.getTable("docs");

  const factory = (settings?: Record<string, unknown>) =>
    new OperationsFactory(
      new ExecutionContext({
        schema: docsRegistry,
        dialect: new QueryBuilder(),
        session: mockSession,
        settings,
      })
    );

  const insert = (settings?: Record<string, unknown>) =>
    factory(settings).createInsertOperation(table, {
      mode: "one",
      args: {
        data: [
          [
            ["id", new SQLParam("d1")],
            ["title", new SQLParam("t")],
          ],
        ],
      },
    }).query;

  it("fills a column from the setting its $onCreate returns", () => {
    const query = insert({ workspaceId: "w1" });

    expect(query.text).toContain(
      'INSERT INTO "docs" ("id", "workspace_id", "title") VALUES ($1, $2, $3)'
    );
    expect(query.params).toEqual(["d1", "w1", "t"]);
  });

  it("inserts NULL when the setting is unset, for notNull or a policy to refuse", () => {
    expect(insert().params).toEqual(["d1", null, "t"]);
  });

  it("binds a setting anywhere the statement reads one", () => {
    const query = factory({ workspaceId: "w1" }).createSelectOperation(table, {
      mode: "many",
      args: { where: sql`${table.columns.workspaceId} = ${params.workspaceId}` },
    }).query;

    expect(query.text).toContain('WHERE "__t0"."workspace_id" = $1');
    expect(query.params).toEqual(["w1"]);
  });
});

describe("OperationFactory / row policies", () => {
  const params = defineSettings({
    workspaceId: new ColumnDefinition("identity.workspace_id"),
    userId: new ColumnDefinition("identity.user_id"),
  });

  const workspaces = new TableDefinition("workspaces", {
    columns: { id: new ColumnDefinition("id").primaryKey() },
  });

  const invoices = new TableDefinition("invoices", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      workspaceId: new ColumnDefinition("workspace_id").notNull(),
      ownerId: new ColumnDefinition("owner_id"),
      number: new ColumnDefinition("number").notNull(),
    },
  })
    .policy("workspace_isolation", (t) => ({
      as: "restrictive",
      using: sql`${t.workspaceId} = ${params.workspaceId}`,
    }))
    .policy("members_read", () => ({ for: "select", using: sql`true` }))
    .policy("owner_writes", (t) => ({
      for: ["update", "delete"],
      using: sql`${t.ownerId} = ${params.userId}`,
    }));

  const lineItems = new TableDefinition("line_items", {
    columns: {
      id: new ColumnDefinition("id").primaryKey(),
      invoiceId: new ColumnDefinition("invoice_id").notNull(),
      workspaceId: new ColumnDefinition("workspace_id").notNull(),
    },
  }).policy("workspace_isolation", (t) => ({
    using: sql`${t.workspaceId} = ${params.workspaceId}`,
  }));

  // Policies but none for select: every read of it is denied.
  const audit = new TableDefinition("audit", {
    columns: { id: new ColumnDefinition("id").primaryKey() },
  }).policy("append_only", () => ({ for: "insert", check: sql`true` }));

  const policyRegistry = new SchemaRegistry({
    workspaces,
    invoices,
    lineItems,
    audit,
    workspaceRelations: new RelationsDefinition(workspaces, {
      invoices: {
        type: Relation.HAS_MANY,
        target: invoices,
        from: [workspaces.columns.id],
        to: [invoices.columns.workspaceId],
      },
    }),
    invoiceRelations: new RelationsDefinition(invoices, {
      lineItems: {
        type: Relation.HAS_MANY,
        target: lineItems,
        from: [invoices.columns.id],
        to: [lineItems.columns.invoiceId],
      },
    }),
  });

  const factory = (settings?: Record<string, unknown>) =>
    new OperationsFactory(
      new ExecutionContext({
        schema: policyRegistry,
        dialect: new QueryBuilder(),
        session: mockSession,
        settings,
      })
    );

  const scoped = () => factory({ workspaceId: "w1", userId: "u1" });
  const table = (alias: string) => policyRegistry.getTable(alias) as AnyTable;

  it("bounds a select that carries no where of its own", () => {
    const query = scoped().createSelectOperation(table("invoices"), {
      mode: "many",
      args: {},
    }).query;

    expect(query.text).toContain(`WHERE (true) AND ("__t0"."workspace_id" = $1)`);
    expect(query.params).toEqual(["w1"]);
  });

  it("puts the policies before the caller's own condition", () => {
    const invoicesTable = table("invoices");
    const query = scoped().createSelectOperation(invoicesTable, {
      mode: "many",
      args: { where: sql.eq(invoicesTable.columns.number, "INV-1") },
    }).query;

    expect(query.text).toContain(
      `WHERE ((true) AND ("__t0"."workspace_id" = $1)) AND ("__t0"."number" = $2)`
    );
  });

  it("leaves a table without policies alone", () => {
    const query = scoped().createSelectOperation(table("workspaces"), {
      mode: "many",
      args: {},
    }).query;

    expect(query.text).not.toContain("WHERE");
  });

  it("renders a lone policy bare, like a lone where", () => {
    const query = scoped().createSelectOperation(table("lineItems"), {
      mode: "many",
      args: {},
    }).query;

    expect(query.text).toContain(`WHERE "__t0"."workspace_id" = $1`);
  });

  it("denies a command no permissive policy covers", () => {
    const query = scoped().createSelectOperation(table("audit"), { mode: "many", args: {} }).query;

    expect(query.text).toContain("WHERE false");
  });

  it("bounds every level of a nested join, each under its own alias", () => {
    const query = scoped().createSelectOperation(table("workspaces"), {
      mode: "many",
      args: { join: [["invoices", { join: [["lineItems", {}]] }]] },
    }).query;

    expect(query.text).toContain(`(true) AND ("__t1"."workspace_id" = $`);
    expect(query.text).toContain(`"__t2"."workspace_id" = $`);
    expect(query.params).toEqual(["w1", "w1"]);
  });

  it("bounds a count", () => {
    const query = scoped().createCountOperation(table("lineItems"), {
      mode: "one",
      args: {},
    }).query;

    expect(query.text).toBe(
      `SELECT count(*) AS "count" FROM "line_items" AS "__t0" WHERE "__t0"."workspace_id" = $1`
    );
  });

  it("bounds an update by its own policies and the select ones, each policy once", () => {
    const invoicesTable = table("invoices");
    const query = scoped().createUpdateOperation(invoicesTable, {
      mode: "one",
      args: {
        set: [["number", new SQLParam("INV-2")]],
        where: sql.eq(invoicesTable.columns.id, "i1"),
      },
    }).query;

    expect(query.text).toContain(
      `WHERE (("invoices"."owner_id" = $2) AND (true) AND ("invoices"."workspace_id" = $3)) ` +
        `AND ("invoices"."id" = $4)`
    );
    expect(query.params).toEqual(["INV-2", "u1", "w1", "i1"]);
  });

  it("bounds a delete the same way", () => {
    const invoicesTable = table("invoices");
    const query = scoped().createDeleteOperation(invoicesTable, {
      mode: "one",
      args: { where: sql.eq(invoicesTable.columns.id, "i1") },
    }).query;

    expect(query.text).toContain(
      `WHERE (("invoices"."owner_id" = $1) AND (true) AND ("invoices"."workspace_id" = $2))`
    );
  });

  it("binds an unset setting as NULL, which no row equals", () => {
    const query = factory().createSelectOperation(table("lineItems"), {
      mode: "many",
      args: {},
    }).query;

    expect(query.params).toEqual([null]);
  });

  it("ORs permissive policies and ANDs restrictive ones onto them", () => {
    const notes = new TableDefinition("notes", {
      columns: {
        id: new ColumnDefinition("id").primaryKey(),
        ownerId: new ColumnDefinition("owner_id"),
        shared: new ColumnDefinition("shared"),
      },
    })
      .policy("own", (t) => ({ using: sql`${t.ownerId} = ${params.userId}` }))
      .policy("shared", (t) => ({ for: "select", using: sql`${t.shared}` }))
      .policy("live", () => ({ as: "restrictive", using: sql`true` }));

    const registry = new SchemaRegistry({ notes });
    const query = new OperationsFactory(
      new ExecutionContext({
        schema: registry,
        dialect: new QueryBuilder(),
        session: mockSession,
        settings: { userId: "u1" },
      })
    ).createSelectOperation(registry.getTable("notes"), { mode: "many", args: {} }).query;

    expect(query.text).toContain(
      `WHERE (("__t0"."owner_id" = $1) OR ("__t0"."shared")) AND (true)`
    );
  });
});
