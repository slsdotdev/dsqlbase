import { describe, expectTypeOf, it, vi } from "vitest";
import {
  ColumnConfig,
  ColumnDefinition,
  RelationsDefinition,
  TableDefinition,
} from "@dsqlbase/core/definition";
import { ExecutionContext, SchemaRegistry } from "@dsqlbase/core/runtime";
import { QueryBuilder } from "@dsqlbase/core";
import { ModelClient } from "./client.js";

const model = new TableDefinition("model_def", {
  columns: {
    id: new ColumnDefinition<"id", ColumnConfig<string, string>>("id").primaryKey(),
    firstName: new ColumnDefinition("first_name").notNull(),
    lastName: new ColumnDefinition("last_name").notNull(),
    emailAddress: new ColumnDefinition("email_address").unique(),
    phoneNumber: new ColumnDefinition("phone_number"),
    address: new ColumnDefinition<"address", ColumnConfig<string, string>>("address"),
  },
});

const contacts = new TableDefinition("contacts", {
  columns: {
    id: new ColumnDefinition<"id", ColumnConfig<string, string>>("id").primaryKey(),
    userId: new ColumnDefinition<"user_id", ColumnConfig<string, string>>("user_id").notNull(),
    type: new ColumnDefinition("type").notNull(),
    value: new ColumnDefinition("value").notNull(),
  },
});

const userRelations = new RelationsDefinition("model_def", {
  table: model,
  relations: {
    contacts: {
      target: contacts,
      type: "has_many",
      from: [model["_columns"].id],
      to: [contacts["_columns"].userId],
    },
  },
});

const contactsRelations = new RelationsDefinition("contacts", {
  table: contacts,
  relations: {
    owner: {
      target: model,
      type: "belongs_to",
      from: [contacts["_columns"].userId],
      to: [model["_columns"].id],
    },
  },
});

const schema = {
  users: model,
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

const { users } = context.schema.getTables();
const client = new ModelClient(context, users);

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
          id: "123",
          firstName: "John",
          lastName: "Doe",
        },
        return: null,
      })
    ).toEqualTypeOf<Record<string, never> | null>();
  });

  it("should infer return type as full record if `return` is true", async () => {
    expectTypeOf(
      client.create({
        data: {
          id: "123",
          firstName: "John",
          lastName: "Doe",
        },
        return: true,
      })
    ).toEqualTypeOf<{
      id: string;
      firstName: unknown;
      lastName: unknown;
      emailAddress: unknown;
      phoneNumber: unknown;
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
    ).toEqualTypeOf<{ id: string; firstName: unknown } | null>();
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
    ).toEqualTypeOf<{ id: string; lastName: unknown }[]>();
  });

  it("should infer joined relations", async () => {
    expectTypeOf(
      client.findOne({
        where: { id: { eq: "123" } },
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
      firstName: unknown;
      lastName: unknown;
      contacts: { value: unknown }[];
    } | null>();
  });
});
