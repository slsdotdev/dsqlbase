import { describe, expect, it } from "vitest";
import { diffTableOperations } from "./table.js";
import { SerializedObject } from "../../base.js";
import { AnyColumnDefinition, AnyTableDefinition } from "@dsqlbase/core/definition";

type Column = SerializedObject<AnyColumnDefinition>;
type Table = SerializedObject<AnyTableDefinition>;

const idColumn: Column = {
  kind: "COLUMN",
  name: "id",
  dataType: "uuid",
  notNull: true,
  primaryKey: true,
  unique: false,
  defaultValue: "gen_random_uuid()",
  check: null,
  domain: null,
  generated: null,
  identity: null,
} as Column;

const emailColumn: Column = {
  kind: "COLUMN",
  name: "email",
  dataType: "text",
  notNull: false,
  primaryKey: false,
  unique: false,
  defaultValue: null,
  check: null,
  domain: null,
  generated: null,
  identity: null,
} as Column;

const baseTable: Table = {
  kind: "TABLE",
  name: "users",
  namespace: "public",
  columns: [idColumn, emailColumn],
  indexes: [],
  constraints: [],
} as Table;

describe("diffTableOperations — existing remote", () => {
  describe("columns", () => {
    it("emits a bare ADD COLUMN for a plain new column", () => {
      const newCol: Column = { ...emailColumn, name: "nickname" };
      const local: Table = { ...baseTable, columns: [...baseTable.columns, newCol] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        type: "ALTER",
        statement: {
          __kind: "ALTER_TABLE",
          name: "users",
          actions: [
            {
              __kind: "ADD_COLUMN",
              column: expect.objectContaining({
                name: "nickname",
                notNull: false,
                isPrimaryKey: false,
                unique: false,
                defaultValue: null,
              }),
            },
          ],
        },
      });
    });

    it("ADD COLUMN with unique:true emits bare ADD + index + USING INDEX", () => {
      const newCol: Column = { ...emailColumn, name: "nickname", unique: true };
      const local: Table = { ...baseTable, columns: [...baseTable.columns, newCol] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(3);

      const [alter, createIdx, addConstraint] = result.operations;
      expect(alter.statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [{ __kind: "ADD_COLUMN" }],
      });
      expect(createIdx.statement).toMatchObject({
        __kind: "CREATE_INDEX",
        name: "users_nickname_key_idx",
        unique: true,
        async: true,
      });
      expect(addConstraint.statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ADD_CONSTRAINT_USING_INDEX",
            name: "users_nickname_key",
            kind: "UNIQUE",
            indexName: "users_nickname_key_idx",
          },
        ],
      });
    });

    it("ADD COLUMN with identity emits bare ADD + ALTER COLUMN ADD IDENTITY", () => {
      const newCol: Column = {
        ...emailColumn,
        name: "counter",
        dataType: "bigint",
        identity: {
          type: "BY DEFAULT",
          sequenceName: "users_counter_seq",
          options: {
            dataType: "bigint",
            cache: 1,
            cycle: false,
            increment: 1,
            minValue: 1,
            maxValue: 1_000_000,
            startValue: 1,
            ownedBy: undefined,
          },
        },
      };
      const local: Table = { ...baseTable, columns: [...baseTable.columns, newCol] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          { __kind: "ADD_COLUMN", column: expect.objectContaining({ name: "counter" }) },
          {
            __kind: "ALTER_COLUMN",
            columnName: "counter",
            actions: [{ __kind: "ADD_IDENTITY", mode: "BY_DEFAULT" }],
          },
        ],
      });
    });

    it("ADD COLUMN with a domain data type carries the domain in references", () => {
      const newCol: Column = {
        ...emailColumn,
        name: "address",
        dataType: "email_addr",
        domain: "email_addr",
      };
      const local: Table = { ...baseTable, columns: [...baseTable.columns, newCol] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        type: "ALTER",
        statement: {
          actions: [
            {
              __kind: "ADD_COLUMN",
              column: expect.objectContaining({ name: "address", dataType: "email_addr" }),
            },
          ],
        },
      });
      expect(result.operations[0].references).toEqual(expect.arrayContaining(["email_addr"]));
    });

    it("refuses ADD COLUMN with notNull/default/check", () => {
      const newCol: Column = {
        ...emailColumn,
        name: "status",
        notNull: true,
        defaultValue: "'active'",
        check: { kind: "CHECK_CONSTRAINT", name: "status_chk", expression: "status <> ''" },
      };
      const local: Table = { ...baseTable, columns: [...baseTable.columns, newCol] };

      const result = diffTableOperations(local, baseTable);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_COLUMN",
        subject: "status",
      });
      expect(result.errors[0].message).toContain("NOT NULL");
      expect(result.errors[0].message).toContain("DEFAULT");
      expect(result.errors[0].message).toContain("CHECK");
    });

    it("refuses dropping a column with NO_DROP_COLUMN", () => {
      const local: Table = { ...baseTable, columns: [idColumn] };

      const result = diffTableOperations(local, baseTable);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "NO_DROP_COLUMN",
        subject: "email",
      });
    });

    it.each([
      ["dataType", { dataType: "varchar" }],
      ["notNull", { notNull: true }],
      ["defaultValue", { defaultValue: "'x'" }],
      ["primaryKey", { primaryKey: true }],
      ["domain", { domain: "email_addr" }],
    ])("refuses column modify on %s", (_attr, override) => {
      const modified: Column = { ...emailColumn, ...(override as Partial<Column>) };
      const local: Table = { ...baseTable, columns: [idColumn, modified] };

      const result = diffTableOperations(local, baseTable);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_COLUMN",
        subject: "email",
      });
    });

    it("collapses multiple blocked attrs into one IMMUTABLE_COLUMN refusal", () => {
      const modified: Column = {
        ...emailColumn,
        notNull: true,
        defaultValue: "'x'",
      };
      const local: Table = { ...baseTable, columns: [idColumn, modified] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toHaveLength(1);
      const error = result.errors[0];
      expect(error.code).toBe("IMMUTABLE_COLUMN");
      expect(error.diffs?.map((d) => d.key).sort()).toEqual(["defaultValue", "notNull"]);
    });

    it("refuses unique:true → false transition", () => {
      const remoteUnique: Column = { ...emailColumn, unique: true };
      const remote: Table = { ...baseTable, columns: [idColumn, remoteUnique] };
      const local: Table = baseTable;

      const result = diffTableOperations(local, remote);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_COLUMN",
        subject: "email",
      });
    });

    it("emits UNIQUE promotion path on unique:false → true transition", () => {
      const localUnique: Column = { ...emailColumn, unique: true };
      const local: Table = { ...baseTable, columns: [idColumn, localUnique] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(2);

      const [createIdx, addConstraint] = result.operations;
      expect(createIdx.statement).toMatchObject({
        __kind: "CREATE_INDEX",
        name: "users_email_key_idx",
        unique: true,
        async: true,
      });
      expect(addConstraint.statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ADD_CONSTRAINT_USING_INDEX",
            name: "users_email_key",
            kind: "UNIQUE",
            indexName: "users_email_key_idx",
          },
        ],
      });
      expect(addConstraint.references).toEqual(
        expect.arrayContaining(["users", "users_email_key_idx"])
      );
    });
  });

  describe("identity", () => {
    const idIdentity = {
      type: "BY DEFAULT" as const,
      sequenceName: "users_id_seq",
      options: {
        dataType: "bigint",
        cache: 1,
        cycle: false,
        increment: 1,
        minValue: 1,
        maxValue: 1_000_000,
        startValue: 1,
        ownedBy: undefined,
      },
    };

    it("emits ALTER COLUMN ADD IDENTITY when added", () => {
      const local: Table = {
        ...baseTable,
        columns: [{ ...idColumn, identity: idIdentity }, emailColumn],
      };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ALTER_COLUMN",
            columnName: "id",
            actions: [{ __kind: "ADD_IDENTITY", mode: "BY_DEFAULT" }],
          },
        ],
      });
    });

    it("emits ALTER COLUMN DROP IDENTITY when removed", () => {
      const remote: Table = {
        ...baseTable,
        columns: [{ ...idColumn, identity: idIdentity }, emailColumn],
      };

      const result = diffTableOperations(baseTable, remote);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ALTER_COLUMN",
            actions: [{ __kind: "DROP_IDENTITY", ifExists: true }],
          },
        ],
      });
    });

    it("emits SET GENERATED + RESTART when mode and startValue both change", () => {
      const localIdentity = {
        ...idIdentity,
        type: "ALWAYS" as const,
        options: { ...idIdentity.options, startValue: 1000 },
      };
      const local: Table = {
        ...baseTable,
        columns: [{ ...idColumn, identity: localIdentity }, emailColumn],
      };
      const remote: Table = {
        ...baseTable,
        columns: [{ ...idColumn, identity: idIdentity }, emailColumn],
      };

      const result = diffTableOperations(local, remote);

      expect(result.errors).toEqual([]);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ALTER_COLUMN",
            actions: [
              { __kind: "SET_GENERATED", mode: "ALWAYS" },
              { __kind: "RESTART", with: 1000 },
            ],
          },
        ],
      });
    });
  });

  describe("indexes", () => {
    const idx = {
      kind: "INDEX" as const,
      name: "users_email_idx",
      unique: false,
      distinctNulls: true,
      columns: [
        {
          kind: "INDEX_COLUMN" as const,
          name: "users_email_idx_column_email" as const,
          sortDirection: "ASC" as const,
          nulls: "LAST" as const,
          column: "email",
        },
      ],
      include: null,
    };

    it("emits CREATE INDEX ASYNC when an index is added", () => {
      const local: Table = { ...baseTable, indexes: [idx] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "CREATE_INDEX",
        name: "users_email_idx",
        async: true,
      });
    });

    it("emits DROP INDEX RESTRICT when an index is removed", () => {
      const remote: Table = { ...baseTable, indexes: [idx] };

      const result = diffTableOperations(baseTable, remote);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].statement).toMatchObject({
        __kind: "DROP_INDEX",
        name: "users_email_idx",
        cascade: "RESTRICT",
      });
    });

    it("refuses index modifications with IMMUTABLE_INDEX", () => {
      const local: Table = { ...baseTable, indexes: [{ ...idx, unique: true }] };
      const remote: Table = { ...baseTable, indexes: [idx] };

      const result = diffTableOperations(local, remote);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_INDEX",
        subject: "users_email_idx",
      });
    });
  });

  describe("constraints", () => {
    const uniqueConstraint = {
      kind: "UNIQUE_CONSTRAINT" as const,
      name: "users_email_unique",
      columns: ["email"],
      include: null,
      distinctNulls: true,
    };
    const pkConstraint = {
      kind: "PRIMARY_KEY_CONSTRAINT" as const,
      name: "users_pk",
      columns: ["id"],
      include: null,
    };
    const checkConstraint = {
      kind: "CHECK_CONSTRAINT" as const,
      name: "users_email_chk",
      expression: "email <> ''",
    };

    it("emits CREATE INDEX + USING INDEX when a UNIQUE constraint is added", () => {
      const local: Table = { ...baseTable, constraints: [uniqueConstraint] };

      const result = diffTableOperations(local, baseTable);

      expect(result.errors).toEqual([]);
      expect(result.operations).toHaveLength(2);

      const [createIdx, addConstraint] = result.operations;
      expect(createIdx.statement).toMatchObject({
        __kind: "CREATE_INDEX",
        name: "users_email_unique_idx",
        unique: true,
        async: true,
      });
      expect(addConstraint.statement).toMatchObject({
        __kind: "ALTER_TABLE",
        actions: [
          {
            __kind: "ADD_CONSTRAINT_USING_INDEX",
            name: "users_email_unique",
            kind: "UNIQUE",
            indexName: "users_email_unique_idx",
          },
        ],
      });
    });

    it("refuses adding a PRIMARY KEY constraint to existing table", () => {
      const local: Table = { ...baseTable, constraints: [pkConstraint] };

      const result = diffTableOperations(local, baseTable);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_CONSTRAINT",
        subject: "users_pk",
      });
    });

    it("refuses adding a CHECK constraint to existing table", () => {
      const local: Table = { ...baseTable, constraints: [checkConstraint] };

      const result = diffTableOperations(local, baseTable);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_CONSTRAINT",
        subject: "users_email_chk",
      });
    });

    it("refuses dropping a UNIQUE constraint", () => {
      const remote: Table = { ...baseTable, constraints: [uniqueConstraint] };

      const result = diffTableOperations(baseTable, remote);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_CONSTRAINT",
        subject: "users_email_unique",
      });
    });

    it("refuses modifying a UNIQUE constraint's columns", () => {
      const remote: Table = { ...baseTable, constraints: [uniqueConstraint] };
      const local: Table = {
        ...baseTable,
        constraints: [{ ...uniqueConstraint, columns: ["email", "id"] }],
      };

      const result = diffTableOperations(local, remote);

      expect(result.operations).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: "IMMUTABLE_CONSTRAINT",
        subject: "users_email_unique",
      });
    });
  });
});
