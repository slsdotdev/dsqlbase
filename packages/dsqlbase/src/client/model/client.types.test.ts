import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ExecutionContext,
  SchemaRegistry,
  QueryBuilder,
  ExecutableQuery,
} from "@dsqlbase/core/runtime";
import {
  belongsTo,
  hasMany,
  relations,
  table,
  tenantScope,
  text,
  uuid,
} from "../../schema/index.js";
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

/**
 * Every result record carries `$$meta`. Neither fixture table declares `table().meta()`, so
 * only the built-ins are present; the declared half is covered separately below.
 */
interface Meta {
  key: string;
  table: string;
  schema?: string;
}

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
    expectTypeOf(query.$typeOf).toEqualTypeOf<{ id: string; $$meta: Meta } | null>();
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
      $$meta: Meta;
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
        $$meta: Meta;
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

    expectTypeOf(query.$typeOf).toEqualTypeOf<{ id: string; lastName: string; $$meta: Meta }[]>();
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
      $$meta: Meta;
      contacts: {
        type: string;
        value: string;
        $$meta: Meta;
        owner: {
          id: string;
          firstName: string;
          lastName: string;
          emailAddress: string;
          phoneNumber: string | null;
          address: string | null;
          $$meta: Meta;
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
      $$meta: { key: string; table: string; schema?: string; __typename: string };
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
        $$meta: { key: string; table: string; schema?: string; __typename: string };
        employees: {
          id: string;
          $$meta: { key: string; table: string; schema?: string; __typename: string };
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
      $$meta: Meta;
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

const documentClient = new ModelClient(documentContext, documentContext.schema.getTables().documents);

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
      $$meta: Meta;
    } | null>();
  });
});
