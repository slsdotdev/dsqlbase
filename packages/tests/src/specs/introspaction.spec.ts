import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Kind } from "@dsqlbase/core";
import { introspection } from "@dsqlbase/schema/migration";
import { createClient, TestClient } from "../client/index.js";
import { schema } from "../schema/index.js";
import path from "node:path";
import { writeFile } from "node:fs/promises";

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
    client = await createClient();
    const [result] = await client.session.execute<{ definitions: SchemaNode[] } | null>(
      introspection.toQuery()
    );

    definitions = result?.definitions ?? [];
    await writeFile(
      path.join(__dirname, "../schema/data/schema-introspection-result.json"),
      JSON.stringify(definitions, null, 2)
    );

    await writeFile(
      path.join(__dirname, "../schema/data/schema.json"),
      JSON.stringify(
        Object.values(schema).map((d) => d.toJSON()),
        null,
        2
      )
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
      expect(membersTable).toHaveProperty("unique");
    });

    it("should match local schema definition", () => {
      const localTable = schema.tasks.toJSON();
      const remoteTable = definitions.find((d) => d.kind === Kind.TABLE && d.name === "tasks");

      expect(remoteTable).toMatchObject(localTable);
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

  describe("Views", () => {
    it("should fetch views", () => {
      const views = definitions.filter((d) => d.kind === Kind.VIEW);
      const viewNames = views.map((v) => v.name);

      expect(viewNames).toContain("active_teams");
    });
  });

  describe("Functions", () => {
    it("should fetch functions", () => {
      const functions = definitions.filter((d) => d.kind === Kind.FUNCTION);
      const funcNames = functions.map((f) => f.name);

      expect(funcNames).toContain("project_count");
    });
  });
});
