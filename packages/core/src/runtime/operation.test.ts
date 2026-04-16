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

    const { query } = factory.createInsertOperation<{ id: string }>(users, {
      name: "insert_user",
      mode: "one",
      args: {
        data: [
          [
            [users.columns.id, new SQLParam(1)],
            [users.columns.name, new SQLParam("Alice")],
            [users.columns.email, new SQLParam(null)],
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
          expect.objectContaining({ _value: null }),
        ]),
      ]),
      return: [users.columns.id],
    });

    expect(query.text).toBe("INSERT");
  });

  it("should resolve insert operation results", () => {
    mockDialect.buildInsertQuery.mockReturnValue(sql`INSERT`);

    const users = registry.getTable("users");

    const operation = factory.createInsertOperation<{ id: string }>(users, {
      name: "insert_user",
      mode: "one",
      args: {
        data: [
          [
            [users.columns.id, new SQLParam(1)],
            [users.columns.name, new SQLParam("Alice")],
            [users.columns.email, new SQLParam(null)],
          ],
        ],
        return: [["id", users.columns.id]],
      },
    });

    const result = operation.resolve([{ id: 1 }]);
    expect(result).toEqual({ id: 1 });
  });

  it("should create a select operation", () => {
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    const users = registry.getTable("users");
    const whereClause = sql`${users.columns.name} = ${sql.param("Alice")}`;

    const { query } = factory.createSelectOperation<{ id: string }>(users, {
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

    const operation = factory.createSelectOperation<{ id: string }, "one">(users, {
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
    expect(result).toEqual({ id: 1, name: "Alice" });
  });

  it("should resolve many select operation results", () => {
    mockDialect.buildSelectQuery.mockReturnValue(sql`SELECT`);
    const users = registry.getTable("users");

    const operation = factory.createSelectOperation<{ id: string }, "many">(users, {
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
      { id: 1, name: "Alice" },
      { id: 2, name: "Alex" },
    ]);
  });

  it("should create an update operation", () => {
    mockDialect.buildUpdateQuery.mockReturnValue(sql`UPDATE`);
    const users = registry.getTable("users");

    const { query } = factory.createUpdateOperation<{ id: string }>(users, {
      name: "update_user",
      mode: "one",
      args: {
        set: [
          [users.columns.name, sql.param("Alice Updated")],
          [users.columns.email, sql.param("other@email.com")],
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

    const operation = factory.createUpdateOperation<{ id: string }, "one">(users, {
      name: "update_user",
      mode: "one",
      args: {
        set: [
          [users.columns.name, sql.param("Alice Updated")],
          [users.columns.email, sql.param("other@email.com")],
        ],
        where: sql`${users.columns.id} = ${sql.param(1)}`,
        return: [["id", users.columns.id]],
      },
    });

    const result = operation.resolve([{ id: 1 }]);
    expect(result).toEqual({ id: 1 });
  });
});
