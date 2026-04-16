import { describe, expectTypeOf, it, vi } from "vitest";
import { RelationsDefinition } from "@dsqlbase/core/definition";
import { ExecutionContext, SchemaRegistry } from "@dsqlbase/core/runtime";
import { QueryBuilder } from "@dsqlbase/core";
import { ModelClient } from "./client.js";
import { table, text, uuid } from "@dsqlbase/schema";

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

const userRelations = new RelationsDefinition(users, {
  contacts: {
    target: contacts,
    type: "has_many",
    from: [users.columns.id],
    to: [contacts.columns.userId],
  },
});

const contactsRelations = new RelationsDefinition(contacts, {
  owner: {
    target: users,
    type: "belongs_to",
    from: [contacts.columns.userId],
    to: [users.columns.id],
  },
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
    expectTypeOf(
      client.create({
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
      })
    ).toEqualTypeOf<{ id: string } | null>();
  });

  it("should infer return type as null if no fields are selected", async () => {
    expectTypeOf(
      client.create({
        data: {
          firstName: "John",
          lastName: "Doe",
          emailAddress: "john@email.com",
        },
        return: null,
      })
    ).toEqualTypeOf<Record<string, never> | null>();
  });

  it("should infer return type as full record if `return` is true", async () => {
    expectTypeOf(
      client.create({
        data: {
          firstName: "John",
          lastName: "Doe",
          emailAddress: "john@mail.com",
        },
        return: true,
      })
    ).toEqualTypeOf<{
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
    ).toEqualTypeOf<{ id: string; firstName: string } | null>();
  });

  it("should infer args type for findMany", async () => {
    expectTypeOf(
      client.findMany({
        where: { firstName: { eq: "John" } },
        distinct: true,
        select: {
          id: true,
          lastName: true,
        },
        limit: 10,
        offset: 20,
        orderBy: { lastName: "asc" },
      })
    ).toEqualTypeOf<{ id: string; lastName: string }[]>();
  });

  it("should infer joined relations", async () => {
    expectTypeOf(
      client.findOne({
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
              value: true,
            },
          },
        },
      })
    ).toEqualTypeOf<{
      id: string;
      firstName: string;
      lastName: string;
      contacts: { value: string }[];
    } | null>();
  });
});
