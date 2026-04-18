import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, TestClient } from "../client/index.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

describe("Schema introspection queries", () => {
  let client: TestClient;

  beforeAll(async () => {
    client = await createClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it("should get info", async () => {
    /**
     * Database schema introspection:
     *
     * - User defined schemas, including "public"
     * - Tables within those schemas
     * - Columns within those tables, including data types and constraints
     * - Indexes and relationships (foreign keys) between tables
     * - Domains, views, and other relevant metadata
     * - Roles and permissions to understand access control
     * - Functions and stored procedures, including their signatures and return types
     * - Exclude system schemas like "pg_catalog", "pg_toast", "sys", and "information_schema" to focus on user-defined schemas and tables.
     *
     * Data structure for the result:
     *
     * {
     *   schemas: [
     *     {
     *       name: "public",
     *       tables: [
     *         {
     *           name: "users",
     *           columns: [
     *             { name: "id", type: "integer", constraints: ["primary key"] },
     *             { name: "name", type: "text", constraints: ["not null"] },
     *             // ...
     *           ],
     *           indexes: [
     *             { name: "users_pkey", columns: ["id"], unique: true },
     *             // ...
     *           ],
     *           relationships: [
     *             { name: "posts_author_id_fkey", targetTable: "posts", targetColumn: "author_id" },
     *             // ...
     *           ]
     *         },
     *         // ...
     *       ]
     *     },
     *     // ...
     *   ]
     * }
     */

    const schemas = await client.pg.sql`
      SELECT
        json_agg(
          json_build_object(
            'name', n.nspname,
            'tables', (
              SELECT json_agg(
                json_build_object(
                  'name', c.relname,
                  'columns', (
                    SELECT json_agg(
                      json_build_object(
                        'name', a.attname,
                        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                        'not_null', a.attnotnull,
                        'primary_key', (
                          SELECT bool_or(con.contype = 'p')
                          FROM pg_constraint con
                          WHERE con.conrelid = c.oid AND a.attnum = ANY(con.conkey)
                        ),
                        'unique', (
                          SELECT bool_or(con.contype = 'u')
                          FROM pg_constraint con
                          WHERE con.conrelid = c.oid AND a.attnum = ANY(con.conkey)
                        ),
                        'constraints', (
                          SELECT array_agg(con.contype)
                          FROM pg_constraint con
                          WHERE con.conrelid = c.oid AND a.attnum = ANY(con.conkey) AND con.contype NOT IN ('p', 'u')
                        )
                      )
                    )
                    FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                  ),
                  'indexes', (
                    SELECT json_agg(
                      json_build_object(
                        'name', i.relname,
                        'columns', (
                          SELECT array_agg(a.attname)
                          FROM pg_index idx
                          JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
                          WHERE idx.indexrelid = i.oid
                        ),
                        'unique', idx.indisunique
                      )
                    )
                    FROM pg_class i
                    JOIN pg_index idx ON idx.indexrelid = i.oid
                    WHERE idx.indrelid = c.oid
                  ),
                  'relationships', (
                    SELECT json_agg(
                      json_build_object(
                        'name', con.conname,
                        'targetTable', (
                          SELECT rel.relname
                          FROM pg_class rel
                          WHERE rel.oid = con.confrelid
                        ),
                        'targetColumn', (
                          SELECT att.attname
                          FROM pg_attribute att
                          WHERE att.attrelid = con.confrelid AND att.attnum = ANY(con.confkey)
                        )
                      )
                    )
                    FROM pg_constraint con
                    WHERE con.conrelid = c.oid AND con.contype = 'f'
                  )
                )
              )
              FROM pg_class c
              WHERE c.relnamespace = n.oid AND c.relkind = 'r'
            )
          )
        ) AS rows
      FROM pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'pg_toast', 'sys', 'information_schema');
    `;

    await writeFile(
      path.resolve(__dirname, "../schema/data/schema-introspection-result.json"),
      JSON.stringify(schemas, null, 2)
    );

    expect(schemas.rows).toBeInstanceOf(Array);
  });
});
