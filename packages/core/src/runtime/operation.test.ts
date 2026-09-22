import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import { sql, SQLNode, SQLParam, SQLQuery } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { OperationsFactory } from "./operation.js";
import { SchemaRegistry } from "./registry.js";
import { QueryBuilder } from "./query.js";

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
      args: { where: sql`${users.columns.id} = ${sql.param(1)}`, return: [["id", users.columns.id]] },
    });

    expect(operation.resolve([{ id: 1 }])).toEqual({
      id: 1,
      $$meta: { key: "users", table: "users" },
    });
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
    const nested = join?.[0]?.params.where;

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
