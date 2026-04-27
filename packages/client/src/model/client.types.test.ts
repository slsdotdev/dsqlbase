import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ExecutionContext,
  SchemaRegistry,
  QueryBuilder,
  ExecutableQuery,
} from "@dsqlbase/core/runtime";
import { belongsTo, hasMany, relations, table, text, uuid } from "@dsqlbase/schema";
import { ModelClient } from "./client.js";

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
    expectTypeOf(query.$typeOf).toEqualTypeOf<{ id: string } | null>();
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

    expectTypeOf(query.$typeOf).toEqualTypeOf<{ id: string; lastName: string }[]>();
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
      contacts: {
        type: string;
        value: string;
        owner: {
          id: string;
          firstName: string;
          lastName: string;
          emailAddress: string;
          phoneNumber: string | null;
          address: string | null;
        } | null;
      }[];
    } | null>();
  });
});
