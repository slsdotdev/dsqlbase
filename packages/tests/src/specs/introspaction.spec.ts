import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Kind } from "@dsqlbase/core";
import { introspection } from "@dsqlbase/schema/migration";

import path from "node:path";
import { writeFile } from "node:fs/promises";

import { applyMigrations } from "../db/migrate.js";
import { createTestClient, TestClient } from "../db/index.js";

const __dirname = new URL(".", import.meta.url).pathname;

interface SchemaNode {
  kind: string;
  name: string;
  schema: string;
}

describe("Schema introspection", () => {
  let client: TestClient;
  let definitions: SchemaNode[];

  beforeAll(async () => {
    client = createTestClient();
    await applyMigrations(client);

    const [result] = await client.$raw<{ definitions: SchemaNode[] } | null>(introspection);

    definitions = result?.definitions ?? [];

    await writeFile(
      path.join(__dirname, "../db/data/introspection-query.sql"),
      introspection.toQuery({ inlineParams: true }).text
    );

    await writeFile(
      path.join(__dirname, "../db/data/schema-introspection-result.json"),
      JSON.stringify(definitions, null, 2)
    );
  });

  afterAll(async () => {
    await client.close();
  });

  it("should run introspection query", async () => {
    expect(definitions).toBeDefined();
  });

  it("should not fetch system schemas", () => {
    expect(definitions).not.toContainEqual(
      expect.objectContaining({
        kind: Kind.SCHEMA,
        name: "pg_catalog",
      })
    );
    expect(definitions).not.toContainEqual(
      expect.objectContaining({
        kind: Kind.SCHEMA,
        name: "pg_toast",
      })
    );
    expect(definitions).not.toContainEqual(
      expect.objectContaining({
        kind: Kind.SCHEMA,
        name: "information_schema",
      })
    );
    expect(definitions).not.toContainEqual(
      expect.objectContaining({
        kind: Kind.SCHEMA,
        name: "sys",
      })
    );
  });

  it("should not include sytems objects", () => {
    const schemas = definitions.map((d) => d.schema);

    expect(schemas).not.toContainEqual("pg_catalog");
    expect(schemas).not.toContainEqual("pg_toast");
    expect(schemas).not.toContainEqual("information_schema");
    expect(schemas).not.toContainEqual("sys");
  });

  describe("Tables", () => {
    it("should fetch table objects", () => {
      const tableNames = definitions.filter((d) => d.kind === Kind.TABLE).map((d) => d.name);
      expect(tableNames).toEqual(
        expect.arrayContaining(["projects", "tasks", "team_members", "teams", "users"])
      );
    });

    it("should fetch columns for tables", () => {
      const projectsTable = definitions.find((d) => d.kind === Kind.TABLE && d.name === "projects");

      expect(projectsTable).toBeDefined();
      expect(projectsTable).toHaveProperty("columns");
    });

    it("should fetch indexes for tables", () => {
      const tasksTable = definitions.find((d) => d.kind === Kind.TABLE && d.name === "tasks");

      expect(tasksTable).toBeDefined();
      expect(tasksTable).toHaveProperty("indexes");
    });

    it("should fetch unique constraints for tables", () => {
      const membersTable = definitions.find(
        (d) => d.kind === Kind.TABLE && d.name === "team_members"
      );

      expect(membersTable).toBeDefined();
    });
  });

  describe("Domains", () => {
    it("should fetch domains", () => {
      const domainNames = definitions.filter((d) => d.kind === Kind.DOMAIN).map((d) => d.name);
      expect(domainNames).toEqual(expect.arrayContaining(["priority_level", "task_status"]));
    });
  });

  describe("Sequences", () => {
    it("should fetch all sequences", () => {
      const sequences = definitions.filter((d) => d.kind === Kind.SEQUENCE);
      const seqNames = sequences.map((s) => s.name);

      expect(seqNames).toContain("task_number_seq");
    });
  });
});
