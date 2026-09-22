import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ColumnDefinition,
  Relation,
  RelationsDefinition,
  TableDefinition,
} from "../definition/index.js";
import { sql, SQLParam } from "../sql/index.js";
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
