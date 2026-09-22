import { describe, expect, it } from "vitest";
import { ColumnConfig, ColumnDefinition } from "./column.js";
import { Kind } from "./base.js";
import { TenantScopeDefinition } from "./tenant.js";

const scope = () =>
  new TenantScopeDefinition({
    workspaceId: new ColumnDefinition("workspace_id", { dataType: "uuid" }).notNull(),
  });

describe("TenantScopeDefinition", () => {
  it("should expose its kind and claim names", () => {
    const ws = scope();

    expect(ws.kind).toBe(Kind.TENANT_SCOPE);
    expect(ws.claims).toEqual(["workspaceId"]);
  });

  it("should reject a claim column that is not notNull", () => {
    expect(
      () => new TenantScopeDefinition({ workspaceId: new ColumnDefinition("workspace_id") })
    ).toThrow(/must be notNull/);
  });

  it("should reject a scope with no claims", () => {
    expect(() => new TenantScopeDefinition({})).toThrow(/no claim columns/);
  });

  it("should mark every claim column as a tenant key and read-only", () => {
    const columns = scope().columns();

    expect(columns.workspaceId["_tenantKey"]).toBe(true);
    expect(columns.workspaceId["_readOnly"]).toBe(true);
    expect(columns.workspaceId.name).toBe("workspace_id");
  });

  it("should return fresh instances on every call", () => {
    const ws = scope();
    const first = ws.columns();
    const second = ws.columns();

    expect(first.workspaceId).not.toBe(second.workspaceId);

    // The builders mutate in place, so a shared instance would let one table's change reach
    // another's column.
    first.workspaceId.notNull();
    expect(second.workspaceId["_tenantKey"]).toBe(true);
  });

  it("should leave the declared claim column untouched", () => {
    const claim = new ColumnDefinition("workspace_id").notNull();
    const ws = new TenantScopeDefinition({ workspaceId: claim });

    ws.columns();

    expect(claim["_tenantKey"]).toBe(false);
    expect(claim["_readOnly"]).toBe(false);
  });

  it("should clone a claim column as its own subclass", () => {
    class TaggedColumn extends ColumnDefinition<string, ColumnConfig> {}

    const ws = new TenantScopeDefinition({
      workspaceId: new TaggedColumn("workspace_id").notNull(),
    });

    expect(ws.columns().workspaceId).toBeInstanceOf(TaggedColumn);
  });

  it("should build a table with the claim columns merged in", () => {
    const invoices = scope().table("invoices", {
      id: new ColumnDefinition("id").primaryKey(),
      number: new ColumnDefinition("number").notNull(),
    });

    expect(Object.keys(invoices.columns)).toEqual(["workspaceId", "id", "number"]);
    expect(invoices.columns.workspaceId["_tenantKey"]).toBe(true);
    expect(invoices.columns.id["_tenantKey"]).toBe(false);
  });

  it("should give each table its own claim column instances", () => {
    const ws = scope();
    const invoices = ws.table("invoices", { id: new ColumnDefinition("id").primaryKey() });
    const receipts = ws.table("receipts", { id: new ColumnDefinition("id").primaryKey() });

    expect(invoices.columns.workspaceId).not.toBe(receipts.columns.workspaceId);
  });

  it("should reject a table that redeclares a claim", () => {
    expect(() =>
      scope().table("invoices", {
        workspaceId: new ColumnDefinition("workspace_id").notNull(),
      })
    ).toThrow(/redeclares claim "workspaceId"/);
  });

  it("should keep the claim column out of the serialized column", () => {
    const columns = scope().columns();

    // `tenantKey` is a client-side rule, like `readOnly`: a real database cannot report it.
    expect(columns.workspaceId.toJSON()).not.toHaveProperty("tenantKey");
    expect(columns.workspaceId.toJSON().notNull).toBe(true);
  });
});
