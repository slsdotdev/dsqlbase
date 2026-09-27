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
interface Meta<TAlias extends string> {
  key: TAlias;
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
