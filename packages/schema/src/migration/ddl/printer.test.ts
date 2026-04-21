import { describe, it, expect } from "vitest";
import { ddl } from "./factory.js";
import { createPrinter } from "./printer.js";

const print = createPrinter(undefined, { inlineParams: true });

describe("printDDL", () => {
  describe("COLUMN_DEFINITION", () => {
    it("prints a basic column", () => {
      const node = ddl.column({
        name: "name",
        dataType: "text",
        notNull: false,
        isPrimaryKey: false,
        unique: false,
        defaultValue: null,
      });

      expect(print(node)).toBe('"name" text');
    });

    it("prints NOT NULL", () => {
      const node = ddl.column({
        name: "name",
        dataType: "text",
        notNull: true,
        isPrimaryKey: false,
        unique: false,
        defaultValue: null,
      });

      expect(print(node)).toBe('"name" text NOT NULL');
    });

    it("prints UNIQUE and NOT NULL", () => {
      const node = ddl.column({
        name: "email",
        dataType: "text",
        notNull: true,
        isPrimaryKey: false,
        unique: true,
        defaultValue: null,
      });

      expect(print(node)).toBe('"email" text NOT NULL UNIQUE');
    });

    it("prints PRIMARY KEY with default", () => {
      const node = ddl.column({
        name: "id",
        dataType: "uuid",
        notNull: true,
        isPrimaryKey: true,
        unique: false,
        defaultValue: "gen_random_uuid()",
      });

      expect(print(node)).toBe('"id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()');
    });

    it("prints DEFAULT value", () => {
      const node = ddl.column({
        name: "is_active",
        dataType: "boolean",
        notNull: true,
        isPrimaryKey: false,
        unique: false,
        defaultValue: "true",
      });

      expect(print(node)).toBe('"is_active" boolean NOT NULL DEFAULT true');
    });

    it("prints inline CHECK constraint", () => {
      const node = ddl.column({
        name: "status",
        dataType: "text",
        notNull: true,
        isPrimaryKey: false,
        unique: false,
        defaultValue: null,
        check: ddl.check({
          name: "chk_status",
          expression: "status IN ('a','b')",
        }),
      });

      expect(print(node)).toBe(
        `"status" text NOT NULL CONSTRAINT "chk_status" CHECK (status IN ('a','b'))`
      );
    });

    it("preserves pre-escaped dataType string", () => {
      const node = ddl.column({
        name: "title",
        dataType: "varchar(100)",
        notNull: false,
        isPrimaryKey: false,
        unique: false,
        defaultValue: null,
      });

      expect(print(node)).toBe('"title" varchar(100)');
    });
  });

  describe("CHECK_CONSTRAINT", () => {
    it("prints a named check constraint", () => {
      const node = ddl.check({
        name: "chk_age",
        expression: "age >= 0",
      });

      expect(print(node)).toBe(`CONSTRAINT "chk_age" CHECK (age >= 0)`);
    });
  });

  describe("PRIMARY_KEY_CONSTRAINT", () => {
    it("prints unnamed primary key", () => {
      const node = ddl.primaryKey({ columns: ["id"] });
      expect(print(node)).toBe(`PRIMARY KEY ("id")`);
    });

    it("prints composite primary key", () => {
      const node = ddl.primaryKey({ columns: ["team_id", "user_id"] });
      expect(print(node)).toBe(`PRIMARY KEY ("team_id", "user_id")`);
    });

    it("prints named primary key", () => {
      const node = ddl.primaryKey({ name: "pk_teams", columns: ["id"] });
      expect(print(node)).toBe(`CONSTRAINT "pk_teams" PRIMARY KEY ("id")`);
    });

    it("prints primary key with INCLUDE", () => {
      const node = ddl.primaryKey({
        columns: ["id"],
        include: ["name", "email"],
      });
      expect(print(node)).toBe(`PRIMARY KEY ("id") INCLUDE ("name", "email")`);
    });
  });

  describe("UNIQUE_CONSTRAINT", () => {
    it("prints unnamed unique", () => {
      const node = ddl.unique({ columns: ["email"] });
      expect(print(node)).toBe(`UNIQUE ("email")`);
    });

    it("prints composite unique", () => {
      const node = ddl.unique({ columns: ["team_id", "user_id"] });
      expect(print(node)).toBe(`UNIQUE ("team_id", "user_id")`);
    });

    it("prints named unique", () => {
      const node = ddl.unique({ name: "uq_slug", columns: ["slug"] });
      expect(print(node)).toBe(`CONSTRAINT "uq_slug" UNIQUE ("slug")`);
    });

    it("prints NULLS NOT DISTINCT", () => {
      const node = ddl.unique({
        columns: ["email"],
        nullsDistinct: false,
      });
      expect(print(node)).toBe(`UNIQUE NULLS NOT DISTINCT ("email")`);
    });

    it("prints NULLS DISTINCT", () => {
      const node = ddl.unique({
        columns: ["email"],
        nullsDistinct: true,
      });
      expect(print(node)).toBe(`UNIQUE NULLS DISTINCT ("email")`);
    });

    it("prints unique with INCLUDE", () => {
      const node = ddl.unique({
        columns: ["team_id", "user_id"],
        include: ["role"],
      });
      expect(print(node)).toBe(`UNIQUE ("team_id", "user_id") INCLUDE ("role")`);
    });
  });

  describe("INDEX_COLUMN", () => {
    it("prints bare column", () => {
      const node = ddl.indexColumn({ columnName: "email" });
      expect(print(node)).toBe(`"email"`);
    });

    it("prints with sort direction", () => {
      const node = ddl.indexColumn({ columnName: "email", sortDirection: "DESC" });
      expect(print(node)).toBe(`"email" DESC`);
    });

    it("prints with NULLS clause", () => {
      const node = ddl.indexColumn({
        columnName: "email",
        sortDirection: "ASC",
        nulls: "LAST",
      });
      expect(print(node)).toBe(`"email" ASC NULLS LAST`);
    });
  });

  describe("CREATE_TABLE", () => {
    it("prints a simple table", () => {
      const node = ddl.createTable({
        name: "users",
        columns: [
          ddl.column({
            name: "id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: true,
            unique: false,
            defaultValue: "gen_random_uuid()",
          }),
          ddl.column({
            name: "email",
            dataType: "text",
            notNull: true,
            isPrimaryKey: false,
            unique: true,
            defaultValue: null,
          }),
        ],
      });

      expect(print(node)).toBe(
        `CREATE TABLE "users" (\n  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),\n  "email" text NOT NULL UNIQUE\n)`
      );
    });

    it("prints IF NOT EXISTS", () => {
      const node = ddl.createTable({
        name: "users",
        ifNotExists: true,
        columns: [
          ddl.column({
            name: "id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: true,
            unique: false,
            defaultValue: null,
          }),
        ],
      });

      expect(print(node)).toBe(
        `CREATE TABLE IF NOT EXISTS "users" (\n  "id" uuid NOT NULL PRIMARY KEY\n)`
      );
    });

    it("prints table with composite unique constraint", () => {
      const node = ddl.createTable({
        name: "team_members",
        columns: [
          ddl.column({
            name: "team_id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
          ddl.column({
            name: "user_id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
        ],
        constraints: [ddl.unique({ columns: ["team_id", "user_id"] })],
      });

      expect(print(node)).toBe(
        `CREATE TABLE "team_members" (\n  "team_id" uuid NOT NULL,\n  "user_id" uuid NOT NULL,\n  UNIQUE ("team_id", "user_id")\n)`
      );
    });
  });

  describe("DROP_TABLE", () => {
    it("prints DROP TABLE", () => {
      const node = ddl.dropTable({ name: "users" });
      expect(print(node)).toBe(`DROP TABLE "users"`);
    });

    it("prints DROP TABLE IF EXISTS", () => {
      const node = ddl.dropTable({ name: "users", ifExists: true });
      expect(print(node)).toBe(`DROP TABLE IF EXISTS "users"`);
    });
  });

  describe("ALTER_TABLE", () => {
    it("prints ALTER TABLE with ADD COLUMN", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.addColumn({
            column: ddl.column({
              name: "age",
              dataType: "integer",
              notNull: false,
              isPrimaryKey: false,
              unique: false,
              defaultValue: null,
            }),
          }),
        ],
      });

      expect(print(node)).toBe(`ALTER TABLE "users" ADD COLUMN "age" integer`);
    });

    it("prints ADD COLUMN IF NOT EXISTS", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.addColumn({
            ifNotExists: true,
            column: ddl.column({
              name: "age",
              dataType: "integer",
              notNull: true,
              isPrimaryKey: false,
              unique: false,
              defaultValue: "0",
            }),
          }),
        ],
      });

      expect(print(node)).toBe(
        `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age" integer NOT NULL DEFAULT 0`
      );
    });
  });

  describe("CREATE_INDEX", () => {
    it("prints basic index", () => {
      const node = ddl.createIndex({
        name: "tasks_project_idx",
        tableName: "tasks",
        columns: [ddl.indexColumn({ columnName: "project_id" })],
      });

      expect(print(node)).toBe(`CREATE INDEX "tasks_project_idx" ON "tasks" ("project_id")`);
    });

    it("prints UNIQUE index", () => {
      const node = ddl.createIndex({
        name: "users_email_idx",
        tableName: "users",
        unique: true,
        columns: [ddl.indexColumn({ columnName: "email" })],
      });

      expect(print(node)).toBe(`CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email")`);
    });

    it("prints ASYNC index", () => {
      const node = ddl.createIndex({
        name: "tasks_status_idx",
        tableName: "tasks",
        async: true,
        columns: [ddl.indexColumn({ columnName: "status" })],
      });

      expect(print(node)).toBe(`CREATE INDEX ASYNC "tasks_status_idx" ON "tasks" ("status")`);
    });

    it("prints UNIQUE ASYNC IF NOT EXISTS", () => {
      const node = ddl.createIndex({
        name: "users_email_idx",
        tableName: "users",
        unique: true,
        async: true,
        ifNotExists: true,
        columns: [ddl.indexColumn({ columnName: "email" })],
      });

      expect(print(node)).toBe(
        `CREATE UNIQUE INDEX ASYNC IF NOT EXISTS "users_email_idx" ON "users" ("email")`
      );
    });

    it("prints composite index", () => {
      const node = ddl.createIndex({
        name: "projects_team_key_idx",
        tableName: "projects",
        unique: true,
        columns: [
          ddl.indexColumn({ columnName: "team_id" }),
          ddl.indexColumn({ columnName: "key" }),
        ],
      });

      expect(print(node)).toBe(
        `CREATE UNIQUE INDEX "projects_team_key_idx" ON "projects" ("team_id", "key")`
      );
    });

    it("prints index with INCLUDE", () => {
      const node = ddl.createIndex({
        name: "tasks_due_date_idx",
        tableName: "tasks",
        columns: [ddl.indexColumn({ columnName: "due_date" })],
        include: ["status"],
      });

      expect(print(node)).toBe(
        `CREATE INDEX "tasks_due_date_idx" ON "tasks" ("due_date") INCLUDE ("status")`
      );
    });

    it("prints index with DESC column and NULLS LAST", () => {
      const node = ddl.createIndex({
        name: "tasks_date_idx",
        tableName: "tasks",
        columns: [
          ddl.indexColumn({
            columnName: "due_date",
            sortDirection: "DESC",
            nulls: "LAST",
          }),
        ],
      });

      expect(print(node)).toBe(
        `CREATE INDEX "tasks_date_idx" ON "tasks" ("due_date" DESC NULLS LAST)`
      );
    });

    it("prints NULLS NOT DISTINCT", () => {
      const node = ddl.createIndex({
        name: "users_email_idx",
        tableName: "users",
        unique: true,
        columns: [ddl.indexColumn({ columnName: "email" })],
        nullsDistinct: false,
      });

      expect(print(node)).toBe(
        `CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email") NULLS NOT DISTINCT`
      );
    });
  });

  describe("DROP_INDEX", () => {
    it("prints DROP INDEX", () => {
      const node = ddl.dropIndex({ name: "users_email_idx" });
      expect(print(node)).toBe(`DROP INDEX "users_email_idx"`);
    });

    it("prints DROP INDEX IF EXISTS", () => {
      const node = ddl.dropIndex({ name: "users_email_idx", ifExists: true });
      expect(print(node)).toBe(`DROP INDEX IF EXISTS "users_email_idx"`);
    });
  });

  describe("end-to-end reference table", () => {
    it("reproduces team_members table body", () => {
      const node = ddl.createTable({
        name: "team_members",
        columns: [
          ddl.column({
            name: "id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: true,
            unique: false,
            defaultValue: "gen_random_uuid()",
          }),
          ddl.column({
            name: "team_id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
          ddl.column({
            name: "user_id",
            dataType: "uuid",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
          ddl.column({
            name: "role",
            dataType: "text",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
          ddl.column({
            name: "created_at",
            dataType: "timestamp",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
          ddl.column({
            name: "updated_at",
            dataType: "timestamp",
            notNull: true,
            isPrimaryKey: false,
            unique: false,
            defaultValue: null,
          }),
        ],
        constraints: [ddl.unique({ columns: ["team_id", "user_id"] })],
      });

      expect(print(node)).toBe(
        [
          `CREATE TABLE "team_members" (`,
          `  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),`,
          `  "team_id" uuid NOT NULL,`,
          `  "user_id" uuid NOT NULL,`,
          `  "role" text NOT NULL,`,
          `  "created_at" timestamp NOT NULL,`,
          `  "updated_at" timestamp NOT NULL,`,
          `  UNIQUE ("team_id", "user_id")`,
          `)`,
        ].join("\n")
      );
    });
  });
});
