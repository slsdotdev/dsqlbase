import { describe, it, expect } from "vitest";
import { ddl } from "./factory.js";
import { createPrinter } from "./printer.js";

const print = createPrinter({ inlineParams: true });

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

    it("prints DROP TABLE CASCADE", () => {
      const node = ddl.dropTable({ name: "users", cascade: "CASCADE" });
      expect(print(node)).toBe(`DROP TABLE "users" CASCADE`);
    });

    it("prints DROP TABLE IF EXISTS RESTRICT", () => {
      const node = ddl.dropTable({
        name: "users",
        ifExists: true,
        cascade: "RESTRICT",
      });
      expect(print(node)).toBe(`DROP TABLE IF EXISTS "users" RESTRICT`);
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

    it("prints DROP INDEX CASCADE", () => {
      const node = ddl.dropIndex({ name: "users_email_idx", cascade: "CASCADE" });
      expect(print(node)).toBe(`DROP INDEX "users_email_idx" CASCADE`);
    });

    it("prints DROP INDEX IF EXISTS RESTRICT", () => {
      const node = ddl.dropIndex({
        name: "users_email_idx",
        ifExists: true,
        cascade: "RESTRICT",
      });
      expect(print(node)).toBe(`DROP INDEX IF EXISTS "users_email_idx" RESTRICT`);
    });
  });

  describe("CREATE_SCHEMA", () => {
    it("prints CREATE SCHEMA", () => {
      const node = ddl.createSchema({ name: "analytics" });
      expect(print(node)).toBe(`CREATE SCHEMA "analytics"`);
    });

    it("prints CREATE SCHEMA IF NOT EXISTS", () => {
      const node = ddl.createSchema({ name: "analytics", ifNotExists: true });
      expect(print(node)).toBe(`CREATE SCHEMA IF NOT EXISTS "analytics"`);
    });
  });

  describe("DROP_SCHEMA", () => {
    it("prints DROP SCHEMA", () => {
      const node = ddl.dropSchema({ name: "analytics" });
      expect(print(node)).toBe(`DROP SCHEMA "analytics"`);
    });

    it("prints DROP SCHEMA IF EXISTS", () => {
      const node = ddl.dropSchema({ name: "analytics", ifExists: true });
      expect(print(node)).toBe(`DROP SCHEMA IF EXISTS "analytics"`);
    });

    it("prints DROP SCHEMA CASCADE", () => {
      const node = ddl.dropSchema({ name: "analytics", cascade: "CASCADE" });
      expect(print(node)).toBe(`DROP SCHEMA "analytics" CASCADE`);
    });

    it("prints DROP SCHEMA IF EXISTS RESTRICT", () => {
      const node = ddl.dropSchema({
        name: "analytics",
        ifExists: true,
        cascade: "RESTRICT",
      });
      expect(print(node)).toBe(`DROP SCHEMA IF EXISTS "analytics" RESTRICT`);
    });
  });

  describe("SEQUENCE_OPTIONS", () => {
    it("prints empty options", () => {
      const node = ddl.sequenceOptions({});
      expect(print(node)).toBe(``);
    });

    it("prints dataType", () => {
      const node = ddl.sequenceOptions({ dataType: "bigint" });
      expect(print(node)).toBe(`AS bigint`);
    });

    it("prints a full option set", () => {
      const node = ddl.sequenceOptions({
        dataType: "bigint",
        incrementBy: 1,
        minValue: 0,
        maxValue: 1000000,
        startValue: 1,
        cache: 65536,
        cycle: false,
      });
      expect(print(node)).toBe(
        `AS bigint INCREMENT BY 1 MINVALUE 0 MAXVALUE 1000000 START WITH 1 CACHE 65536 NO CYCLE`
      );
    });

    it("prints CYCLE when true", () => {
      const node = ddl.sequenceOptions({ cycle: true });
      expect(print(node)).toBe(`CYCLE`);
    });

    it("prints OWNED BY raw expression", () => {
      const node = ddl.sequenceOptions({ ownedBy: `"users"."id"` });
      expect(print(node)).toBe(`OWNED BY "users"."id"`);
    });
  });

  describe("CREATE_SEQUENCE", () => {
    it("prints bare CREATE SEQUENCE", () => {
      const node = ddl.createSequence({ name: "task_number_seq" });
      expect(print(node)).toBe(`CREATE SEQUENCE "task_number_seq"`);
    });

    it("prints IF NOT EXISTS", () => {
      const node = ddl.createSequence({ name: "task_number_seq", ifNotExists: true });
      expect(print(node)).toBe(`CREATE SEQUENCE IF NOT EXISTS "task_number_seq"`);
    });

    it("prints with options", () => {
      const node = ddl.createSequence({
        name: "task_number_seq",
        options: ddl.sequenceOptions({
          dataType: "bigint",
          incrementBy: 1,
          startValue: 1,
          cache: 1,
        }),
      });
      expect(print(node)).toBe(
        `CREATE SEQUENCE "task_number_seq" AS bigint INCREMENT BY 1 START WITH 1 CACHE 1`
      );
    });
  });

  describe("DROP_SEQUENCE", () => {
    it("prints DROP SEQUENCE", () => {
      const node = ddl.dropSequence({ name: "task_number_seq" });
      expect(print(node)).toBe(`DROP SEQUENCE "task_number_seq"`);
    });

    it("prints DROP SEQUENCE IF EXISTS CASCADE", () => {
      const node = ddl.dropSequence({
        name: "task_number_seq",
        ifExists: true,
        cascade: "CASCADE",
      });
      expect(print(node)).toBe(`DROP SEQUENCE IF EXISTS "task_number_seq" CASCADE`);
    });
  });

  describe("ALTER_SEQUENCE", () => {
    it("prints options-only alter", () => {
      const node = ddl.alterSequence({
        name: "task_number_seq",
        options: ddl.sequenceOptions({ cache: 65536 }),
      });
      expect(print(node)).toBe(`ALTER SEQUENCE "task_number_seq" CACHE 65536`);
    });

    it("prints RESTART without value", () => {
      const node = ddl.alterSequence({
        name: "task_number_seq",
        restart: {},
      });
      expect(print(node)).toBe(`ALTER SEQUENCE "task_number_seq" RESTART`);
    });

    it("prints RESTART WITH n", () => {
      const node = ddl.alterSequence({
        name: "task_number_seq",
        restart: { with: 1000 },
      });
      expect(print(node)).toBe(`ALTER SEQUENCE "task_number_seq" RESTART WITH 1000`);
    });

    it("prints options + RESTART together", () => {
      const node = ddl.alterSequence({
        name: "task_number_seq",
        options: ddl.sequenceOptions({ incrementBy: 2 }),
        restart: { with: 500 },
      });
      expect(print(node)).toBe(`ALTER SEQUENCE "task_number_seq" INCREMENT BY 2 RESTART WITH 500`);
    });
  });

  describe("CREATE_DOMAIN", () => {
    it("prints bare CREATE DOMAIN", () => {
      const node = ddl.createDomain({ name: "priority_level", dataType: "integer" });
      expect(print(node)).toBe(`CREATE DOMAIN "priority_level" AS integer`);
    });

    it("prints NOT NULL and DEFAULT", () => {
      const node = ddl.createDomain({
        name: "priority_level",
        dataType: "integer",
        notNull: true,
        defaultValue: "0",
      });
      expect(print(node)).toBe(`CREATE DOMAIN "priority_level" AS integer NOT NULL DEFAULT 0`);
    });

    it("prints inline CHECK constraint", () => {
      const node = ddl.createDomain({
        name: "task_status",
        dataType: "text",
        check: ddl.check({
          name: "chk_task_status",
          expression: `VALUE IN ('todo', 'in_progress', 'done', 'cancelled')`,
        }),
      });
      expect(print(node)).toBe(
        `CREATE DOMAIN "task_status" AS text CONSTRAINT "chk_task_status" CHECK (VALUE IN ('todo', 'in_progress', 'done', 'cancelled'))`
      );
    });

    it("preserves pre-escaped dataType", () => {
      const node = ddl.createDomain({ name: "short_text", dataType: "varchar(50)" });
      expect(print(node)).toBe(`CREATE DOMAIN "short_text" AS varchar(50)`);
    });
  });

  describe("DROP_DOMAIN", () => {
    it("prints DROP DOMAIN", () => {
      const node = ddl.dropDomain({ name: "task_status" });
      expect(print(node)).toBe(`DROP DOMAIN "task_status"`);
    });

    it("prints DROP DOMAIN IF EXISTS CASCADE", () => {
      const node = ddl.dropDomain({
        name: "task_status",
        ifExists: true,
        cascade: "CASCADE",
      });
      expect(print(node)).toBe(`DROP DOMAIN IF EXISTS "task_status" CASCADE`);
    });
  });

  describe("IDENTITY_CONSTRAINT", () => {
    it("prints GENERATED BY DEFAULT AS IDENTITY", () => {
      const node = ddl.identity({ mode: "BY_DEFAULT" });
      expect(print(node)).toBe(`GENERATED BY DEFAULT AS IDENTITY`);
    });

    it("prints GENERATED ALWAYS AS IDENTITY", () => {
      const node = ddl.identity({ mode: "ALWAYS" });
      expect(print(node)).toBe(`GENERATED ALWAYS AS IDENTITY`);
    });

    it("prints with sequence options", () => {
      const node = ddl.identity({
        mode: "ALWAYS",
        options: ddl.sequenceOptions({ cache: 65536, startValue: 1 }),
      });
      expect(print(node)).toBe(`GENERATED ALWAYS AS IDENTITY (START WITH 1 CACHE 65536)`);
    });
  });

  describe("GENERATED_EXPRESSION", () => {
    it("prints a stored generated expression", () => {
      const node = ddl.generated({
        expression: `"first" || ' ' || "last"`,
        stored: true,
      });
      expect(print(node)).toBe(`GENERATED ALWAYS AS ("first" || ' ' || "last") STORED`);
    });
  });

  describe("COLUMN_DEFINITION with identity", () => {
    it("prints an identity PK column", () => {
      const node = ddl.column({
        name: "id",
        dataType: "bigint",
        notNull: true,
        isPrimaryKey: true,
        unique: false,
        defaultValue: null,
        identity: ddl.identity({
          mode: "ALWAYS",
          options: ddl.sequenceOptions({ cache: 65536 }),
        }),
      });
      expect(print(node)).toBe(
        `"id" bigint GENERATED ALWAYS AS IDENTITY (CACHE 65536) NOT NULL PRIMARY KEY`
      );
    });
  });

  describe("COLUMN_DEFINITION with generated", () => {
    it("prints a generated column", () => {
      const node = ddl.column({
        name: "full_name",
        dataType: "text",
        notNull: false,
        isPrimaryKey: false,
        unique: false,
        defaultValue: null,
        generated: ddl.generated({
          expression: `"first" || ' ' || "last"`,
          stored: true,
        }),
      });
      expect(print(node)).toBe(
        `"full_name" text GENERATED ALWAYS AS ("first" || ' ' || "last") STORED`
      );
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

  describe("ALTER_COLUMN", () => {
    it("wraps SET NOT NULL in an ALTER TABLE", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "email",
            actions: [ddl.setNotNull()],
          }),
        ],
      });

      expect(print(node)).toBe('ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL');
    });

    it("wraps DROP NOT NULL", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "email",
            actions: [ddl.dropNotNull()],
          }),
        ],
      });

      expect(print(node)).toBe('ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL');
    });

    it("sets DEFAULT", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "status",
            actions: [ddl.setDefault({ expression: "'active'" })],
          }),
        ],
      });

      expect(print(node)).toBe(`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active'`);
    });

    it("drops DEFAULT", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "status",
            actions: [ddl.dropDefault()],
          }),
        ],
      });

      expect(print(node)).toBe('ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT');
    });

    it("sets data type with USING", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "age",
            actions: [ddl.setDataType({ dataType: "bigint", using: "age::bigint" })],
          }),
        ],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "users" ALTER COLUMN "age" SET DATA TYPE bigint USING age::bigint'
      );
    });

    it("sets generated ALWAYS with options", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "id",
            actions: [
              ddl.setGenerated({
                mode: "ALWAYS",
                options: ddl.sequenceOptions({ incrementBy: 1 }),
              }),
            ],
          }),
        ],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "users" ALTER COLUMN "id" SET GENERATED ALWAYS INCREMENT BY 1'
      );
    });

    it("restarts identity with a value", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "id",
            actions: [ddl.restart({ with: 1000 })],
          }),
        ],
      });

      expect(print(node)).toBe('ALTER TABLE "users" ALTER COLUMN "id" RESTART WITH 1000');
    });

    it("drops identity IF EXISTS", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "id",
            actions: [ddl.dropIdentity({ ifExists: true })],
          }),
        ],
      });

      expect(print(node)).toBe('ALTER TABLE "users" ALTER COLUMN "id" DROP IDENTITY IF EXISTS');
    });

    it("repeats ALTER COLUMN prefix for multiple sub-actions", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.alterColumn({
            columnName: "email",
            actions: [ddl.setNotNull(), ddl.setDefault({ expression: "''" })],
          }),
        ],
      });

      expect(print(node)).toBe(
        `ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL, ALTER COLUMN "email" SET DEFAULT ''`
      );
    });

    it("mixes ADD COLUMN and ALTER COLUMN within one ALTER TABLE", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.addColumn({
            column: ddl.column({
              name: "nickname",
              dataType: "text",
              notNull: false,
              isPrimaryKey: false,
              unique: false,
              defaultValue: null,
            }),
          }),
          ddl.alterColumn({
            columnName: "email",
            actions: [ddl.setNotNull()],
          }),
        ],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "users" ADD COLUMN "nickname" text, ALTER COLUMN "email" SET NOT NULL'
      );
    });
  });

  describe("ALTER_DOMAIN", () => {
    it("sets NOT NULL", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.setNotNull(),
      });

      expect(print(node)).toBe('ALTER DOMAIN "email_addr" SET NOT NULL');
    });

    it("drops default", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.dropDefault(),
      });

      expect(print(node)).toBe('ALTER DOMAIN "email_addr" DROP DEFAULT');
    });

    it("sets default", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.setDefault({ expression: "''" }),
      });

      expect(print(node)).toBe(`ALTER DOMAIN "email_addr" SET DEFAULT ''`);
    });

    it("adds a check constraint", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.addConstraint({
          constraint: ddl.check({
            name: "email_addr_format",
            expression: "VALUE ~ '@'",
          }),
        }),
      });

      expect(print(node)).toBe(
        `ALTER DOMAIN "email_addr" ADD CONSTRAINT "email_addr_format" CHECK (VALUE ~ '@')`
      );
    });

    it("drops a constraint with CASCADE", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.dropConstraint({
          name: "email_addr_format",
          ifExists: true,
          cascade: "CASCADE",
        }),
      });

      expect(print(node)).toBe(
        'ALTER DOMAIN "email_addr" DROP CONSTRAINT IF EXISTS "email_addr_format" CASCADE'
      );
    });

    it("validates a constraint", () => {
      const node = ddl.alterDomain({
        name: "email_addr",
        action: ddl.validateConstraint({ name: "email_addr_format" }),
      });

      expect(print(node)).toBe('ALTER DOMAIN "email_addr" VALIDATE CONSTRAINT "email_addr_format"');
    });
  });

  describe("RENAME / SET_SCHEMA actions", () => {
    it("renames a table", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [ddl.rename({ newName: "user_accounts" })],
      });

      expect(print(node)).toBe('ALTER TABLE "users" RENAME TO "user_accounts"');
    });

    it("renames a column", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [ddl.renameColumn({ columnName: "email", newName: "email_address" })],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "users" RENAME COLUMN "email" TO "email_address"'
      );
    });

    it("renames a constraint", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [
          ddl.renameConstraint({
            constraintName: "chk_email",
            newName: "chk_email_format",
          }),
        ],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "users" RENAME CONSTRAINT "chk_email" TO "chk_email_format"'
      );
    });

    it("moves a table to another schema", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [ddl.setSchema({ schemaName: "private" })],
      });

      expect(print(node)).toBe('ALTER TABLE "users" SET SCHEMA "private"');
    });

    it("quotes identifiers with special characters", () => {
      const node = ddl.alterTable({
        name: "users",
        actions: [ddl.rename({ newName: "User Accounts" })],
      });

      expect(print(node)).toBe('ALTER TABLE "users" RENAME TO "User Accounts"');
    });
  });

  describe("ALTER_INDEX", () => {
    it("renames an index", () => {
      const node = ddl.alterIndex({
        name: "idx_users_email",
        action: ddl.rename({ newName: "idx_users_email_addr" }),
      });

      expect(print(node)).toBe(
        'ALTER INDEX "idx_users_email" RENAME TO "idx_users_email_addr"'
      );
    });

    it("moves an index to another schema", () => {
      const node = ddl.alterIndex({
        name: "idx_users_email",
        action: ddl.setSchema({ schemaName: "private" }),
      });

      expect(print(node)).toBe('ALTER INDEX "idx_users_email" SET SCHEMA "private"');
    });

    it("supports IF EXISTS", () => {
      const node = ddl.alterIndex({
        name: "idx_users_email",
        ifExists: true,
        action: ddl.rename({ newName: "idx_users_email_addr" }),
      });

      expect(print(node)).toBe(
        'ALTER INDEX IF EXISTS "idx_users_email" RENAME TO "idx_users_email_addr"'
      );
    });
  });

  describe("schema-qualified names", () => {
    it("qualifies CREATE TABLE", () => {
      const node = ddl.createTable({
        schema: "auth",
        name: "users",
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
        'CREATE TABLE "auth"."users" (\n  "id" uuid NOT NULL PRIMARY KEY\n)'
      );
    });

    it("qualifies DROP TABLE", () => {
      const node = ddl.dropTable({ schema: "auth", name: "users", cascade: "CASCADE" });
      expect(print(node)).toBe('DROP TABLE "auth"."users" CASCADE');
    });

    it("qualifies ALTER TABLE", () => {
      const node = ddl.alterTable({
        schema: "auth",
        name: "users",
        actions: [ddl.rename({ newName: "user_accounts" })],
      });

      expect(print(node)).toBe(
        'ALTER TABLE "auth"."users" RENAME TO "user_accounts"'
      );
    });

    it("qualifies the table reference in CREATE INDEX", () => {
      const node = ddl.createIndex({
        name: "idx_users_email",
        tableSchema: "auth",
        tableName: "users",
        columns: [ddl.indexColumn({ columnName: "email" })],
      });

      expect(print(node)).toBe(
        'CREATE INDEX "idx_users_email" ON "auth"."users" ("email")'
      );
    });

    it("qualifies DROP INDEX", () => {
      const node = ddl.dropIndex({ schema: "auth", name: "idx_users_email" });
      expect(print(node)).toBe('DROP INDEX "auth"."idx_users_email"');
    });

    it("qualifies ALTER INDEX", () => {
      const node = ddl.alterIndex({
        schema: "auth",
        name: "idx_users_email",
        action: ddl.setSchema({ schemaName: "private" }),
      });

      expect(print(node)).toBe(
        'ALTER INDEX "auth"."idx_users_email" SET SCHEMA "private"'
      );
    });

    it("qualifies sequence commands", () => {
      expect(
        print(ddl.createSequence({ schema: "auth", name: "user_id_seq" }))
      ).toBe('CREATE SEQUENCE "auth"."user_id_seq"');

      expect(print(ddl.dropSequence({ schema: "auth", name: "user_id_seq" }))).toBe(
        'DROP SEQUENCE "auth"."user_id_seq"'
      );

      expect(
        print(
          ddl.alterSequence({
            schema: "auth",
            name: "user_id_seq",
            restart: { with: 1000 },
          })
        )
      ).toBe('ALTER SEQUENCE "auth"."user_id_seq" RESTART WITH 1000');
    });

    it("qualifies domain commands", () => {
      expect(
        print(
          ddl.createDomain({ schema: "auth", name: "email_addr", dataType: "text" })
        )
      ).toBe('CREATE DOMAIN "auth"."email_addr" AS text');

      expect(print(ddl.dropDomain({ schema: "auth", name: "email_addr" }))).toBe(
        'DROP DOMAIN "auth"."email_addr"'
      );

      expect(
        print(
          ddl.alterDomain({
            schema: "auth",
            name: "email_addr",
            action: ddl.setNotNull(),
          })
        )
      ).toBe('ALTER DOMAIN "auth"."email_addr" SET NOT NULL');
    });
  });
});
