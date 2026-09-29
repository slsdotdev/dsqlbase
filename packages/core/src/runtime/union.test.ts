import { describe, expect, it, vi } from "vitest";
import {
  ColumnDefinition,
  KEY_FIELD,
  Relation,
  RelationsDefinition,
  TableDefinition,
  TenantScopeDefinition,
  UnionDefinition,
} from "../definition/index.js";
import { sql } from "../sql/index.js";
import { ExecutionContext } from "./context.js";
import { TenancyError } from "./errors.js";
import { OperationsFactory, SelectOperationArgs, UnionSelectOperationArgs } from "./operation.js";
import { QueryBuilder } from "./query.js";
import { SchemaRegistry } from "./registry.js";

const col = (name: string, dataType = "text") => new ColumnDefinition(name, { dataType });

const users = new TableDefinition("users", {
  columns: { id: col("id", "uuid").primaryKey(), name: col("name") },
});

const photos = new TableDefinition("photos", {
  columns: {
    id: col("id", "uuid").primaryKey(),
    userId: col("user_id", "uuid"),
    createdAt: col("created_at", "timestamptz"),
    photoUrl: col("photo_url"),
  },
}).meta({ __typename: "Photo" });

const videos = new TableDefinition("videos", {
  columns: {
    id: col("id", "uuid").primaryKey(),
    userId: col("owner_id", "uuid"),
    createdAt: col("created_at", "timestamptz"),
    videoUrl: col("video_url"),
  },
});

const posts = new UnionDefinition({ photos, videos });

const userRelations = new RelationsDefinition(users, {
  feed: {
    type: Relation.HAS_MANY,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.userId],
  },
  latest: {
    type: Relation.HAS_ONE,
    target: posts,
    from: [users.columns.id],
    to: [posts.columns.userId],
  },
});

const photoRelations = new RelationsDefinition(photos, {
  owner: {
    type: Relation.BELONGS_TO,
    target: users,
    from: [photos.columns.userId],
    to: [users.columns.id],
  },
});

const registry = new SchemaRegistry({
  users,
  photos,
  videos,
  posts,
  userRelations,
  photoRelations,
});

const factory = new OperationsFactory(
  new ExecutionContext({
    schema: registry,
    dialect: new QueryBuilder(),
    session: { execute: vi.fn() },
  })
);

const all = (...aliases: string[]): UnionSelectOperationArgs["members"] =>
  aliases.map((alias) => [alias, { select: [] }]);

const select = (join: SelectOperationArgs["join"], mode: "one" | "many" = "one") =>
  factory.createSelectOperation(registry.getTable("users"), {
    mode,
    args: { select: [["id", registry.getTable("users").columns.id]], join },
  });

describe("union joins — SQL", () => {
  it("renders a has-many as json_agg over a UNION ALL, correlated per member column", () => {
    const { query } = select([["feed", { members: all("photos", "videos") }]]);

    expect(query.text).toBe(
      'SELECT "__t0"."id", "__join_feed"."data" AS "feed" FROM "users" AS "__t0" ' +
        'LEFT JOIN LATERAL (SELECT COALESCE(json_agg("__u0"."data"), \'[]\'::json) AS "data" FROM (' +
        'SELECT row_to_json("__j0".*) AS "data" FROM (' +
        'SELECT \'photos\' AS "$$key", "__t1"."id", "__t1"."user_id", "__t1"."created_at", "__t1"."photo_url" ' +
        'FROM "photos" AS "__t1" WHERE "__t1"."user_id" = "__t0"."id") AS "__j0" ' +
        "UNION ALL " +
        'SELECT row_to_json("__j1".*) AS "data" FROM (' +
        'SELECT \'videos\' AS "$$key", "__t2"."id", "__t2"."owner_id", "__t2"."created_at", "__t2"."video_url" ' +
        'FROM "videos" AS "__t2" WHERE "__t2"."owner_id" = "__t0"."id") AS "__j1"' +
        ') AS "__u0") AS "__join_feed" ON true LIMIT $1'
    );
  });

  it("orders across members by hidden keys, then $$key and the primary key", () => {
    const { query } = select([
      [
        "feed",
        { members: all("photos", "videos"), orderBy: [{ field: "createdAt", direction: "desc" }] },
      ],
    ]);

    expect(query.text).toContain(
      'json_agg("__u0"."data" ORDER BY "__o0" DESC, "$$key" ASC, "__pk0" ASC)'
    );
    expect(query.text).toContain(
      'SELECT row_to_json("__j0".*) AS "data", "__j0"."__o0", "__j0"."$$key", "__j0"."__pk0" FROM ('
    );
    expect(query.text).toContain(
      '"__t1"."created_at" AS "__o0", "__t1"."id" AS "__pk0" FROM "photos" AS "__t1"'
    );
    expect(query.text).toContain(
      ') AS "__j1" ORDER BY "__o0" DESC, "$$key" ASC, "__pk0" ASC) AS "__u0"'
    );
  });

  it("pushes limit + offset down into every branch, ordered the same way", () => {
    const { query } = select([
      [
        "feed",
        {
          members: all("photos", "videos"),
          orderBy: [{ field: "createdAt", direction: "desc" }],
          limit: 20,
          offset: 5,
        },
      ],
    ]);

    expect(query.text).toContain(
      'WHERE "__t2"."owner_id" = "__t0"."id" ORDER BY "__t2"."created_at" DESC, "__t2"."id" ASC LIMIT $'
    );
    expect(query.text).toMatch(
      /ORDER BY "__o0" DESC, "\$\$key" ASC, "__pk0" ASC LIMIT \$\d+ OFFSET \$\d+\) AS "__u0"/
    );
    // Two branches at limit + offset, then the union's own limit and offset, then the root's.
    expect(query.params).toEqual([25, 25, 20, 5, 1]);
  });

  it("orders by $$key as a constant inside each branch and by the column across them", () => {
    const { query } = select([
      [
        "feed",
        {
          members: all("photos", "videos"),
          orderBy: [{ field: KEY_FIELD, direction: "desc" }],
          limit: 3,
        },
      ],
    ]);

    // Sorted by the "$$key" column every branch already projects; no second copy.
    expect(query.text).not.toContain('"__o0"');
    expect(query.text).toContain('ORDER BY "$$key" DESC, "__pk0" ASC LIMIT');
    // Not repeated as a tiebreaker when the caller already ordered by it.
    expect(query.text).not.toContain('"$$key" DESC, "$$key" ASC');
    expect(query.text).toContain('ORDER BY "__t1"."id" ASC LIMIT');
  });

  it("renders a has-one as the single data value of a union limited to one row", () => {
    const { query } = select([
      [
        "latest",
        { members: all("photos", "videos"), orderBy: [{ field: "createdAt", direction: "desc" }] },
      ],
    ]);

    expect(query.text).toContain('LEFT JOIN LATERAL (SELECT "__u0"."data" AS "data" FROM (');
    expect(query.text).toMatch(/"__pk0" ASC LIMIT \$\d+\) AS "__u0"\) AS "__join_latest" ON true/);
  });

  it("builds only the members listed, and a single member still renders a union", () => {
    const { query } = select([["feed", { members: all("videos") }]]);

    expect(query.text).not.toContain('"photos"');
    expect(query.text).not.toContain("UNION ALL");
    expect(query.text).toContain("SELECT 'videos' AS \"$$key\"");
  });

  it("emits no join at all when every member is pruned", () => {
    const { query, resolve } = select([
      ["feed", { members: [] }],
      ["latest", { members: [] }],
    ]);

    expect(query.text).toBe('SELECT "__t0"."id" FROM "users" AS "__t0" LIMIT $1');
    expect(resolve([{ id: "u1" }])).toEqual({
      $$meta: registry.getTable("users").meta,
      id: "u1",
      feed: [],
      latest: null,
    });
  });

  it("gives each branch its own member where and nested joins", () => {
    const photosTable = registry.getTable("photos");

    const { query } = select([
      [
        "feed",
        {
          members: [
            [
              "photos",
              {
                select: [["id", photosTable.columns.id]],
                where: sql.eq(photosTable.columns.photoUrl, "x"),
                join: [["owner", { select: [] }]],
              },
            ],
          ],
        },
      ],
    ]);

    expect(query.text).toContain(
      'WHERE "__t1"."user_id" = "__t0"."id" AND ("__t1"."photo_url" = $2)'
    );
    // A self-referencing path back to users renders under its own alias.
    expect(query.text).toContain('FROM "users" AS "__t2" WHERE "__t2"."id" = "__t1"."user_id"');
  });

  it("rejects ordering by a field the members do not share", () => {
    expect(() =>
      select([
        [
          "feed",
          { members: all("photos", "videos"), orderBy: [{ field: "photoUrl", direction: "asc" }] },
        ],
      ])
    ).toThrow(/only fields every member shares/);
  });

  it("rejects union arguments on a table relation, and table arguments on a union", () => {
    const photosTable = registry.getTable("photos");

    expect(() =>
      factory.createSelectOperation(photosTable, {
        mode: "many",
        args: { select: [], join: [["owner", { members: [] }]] },
      })
    ).toThrow(/targets table "users", but was joined with arguments for a union/);

    expect(() => select([["feed", { select: [] }]])).toThrow(
      /targets union "posts", but was joined with arguments for a table/
    );
  });
});

describe("union joins — belongs-to", () => {
  const comments = new TableDefinition("comments", {
    columns: {
      id: col("id", "uuid").primaryKey(),
      subjectType: col("subject_type"),
      subjectId: col("subject_id", "uuid"),
    },
  });
  const rels = new RelationsDefinition(comments, {
    subject: {
      type: Relation.BELONGS_TO,
      target: posts,
      from: [comments.columns.subjectId],
      to: [posts.columns.id],
      discriminator: comments.columns.subjectType,
    },
  });
  const schema = new SchemaRegistry({ photos, videos, posts, comments, rels });
  const build = () =>
    new OperationsFactory(
      new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
    ).createSelectOperation(schema.getTable("comments"), {
      mode: "many",
      args: { select: [], join: [["subject", { members: all("photos", "videos") }]] },
    });

  it("resolves the discriminator column from the registry", () => {
    expect(schema.getRelationDiscriminator("comments", "subject")).toBe(
      schema.getTable("comments").columns.subjectType
    );
    expect(registry.getRelationDiscriminator("users", "feed")).toBeUndefined();
  });

  // The ids of two members may collide; only the member the discriminator names may match.
  it("correlates each branch on the discriminator naming its member", () => {
    const { query } = build();

    expect(query.text).toContain(
      `FROM "photos" AS "__t1" WHERE "__t1"."id" = "__t0"."subject_id" AND "__t0"."subject_type" = 'photos'`
    );
    expect(query.text).toContain(
      `FROM "videos" AS "__t2" WHERE "__t2"."id" = "__t0"."subject_id" AND "__t0"."subject_type" = 'videos'`
    );
    expect(query.text).toContain('LEFT JOIN LATERAL (SELECT "__u0"."data" AS "data" FROM (');
  });
});

describe("row decoders", () => {
  const comments = new TableDefinition("comments", {
    columns: {
      id: col("id", "uuid").primaryKey(),
      subjectType: col("subject_type"),
      subjectId: col("subject_id", "uuid"),
      body: col("body"),
    },
  });
  const schema = new SchemaRegistry({ comments });
  const table = schema.getTable("comments");

  Object.defineProperty(table.columns.subjectId, "rowDecoder", {
    value: {
      dependsOn: [table.columns.subjectType],
      decode: (raw: unknown, row: Record<string, unknown>) =>
        `${String(row.subject_type)}:${String(raw)}`,
    },
  });

  const select = (fields: string[]) =>
    new OperationsFactory(
      new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
    ).createSelectOperation(table, {
      mode: "many",
      args: {
        select: fields.map((field) => [field, table.columns[field as keyof typeof table.columns]]),
      },
    });

  it("projects the dependency without emitting it, and decodes from the whole row", () => {
    const { query, resolve } = select(["subjectId"]);

    expect(query.text).toBe(
      'SELECT "__t0"."subject_id", "__t0"."subject_type" FROM "comments" AS "__t0"'
    );
    expect(resolve([{ subject_id: "s1", subject_type: "photos" }])).toEqual([
      { $$meta: table.meta, subjectId: "photos:s1" },
    ]);
  });

  it("projects a dependency once when it is also selected", () => {
    const { query, resolve } = select(["subjectType", "subjectId"]);

    expect(query.text).toBe(
      'SELECT "__t0"."subject_type", "__t0"."subject_id" FROM "comments" AS "__t0"'
    );
    expect(resolve([{ subject_id: "s1", subject_type: "photos" }])).toEqual([
      { $$meta: table.meta, subjectType: "photos", subjectId: "photos:s1" },
    ]);
  });

  it("leaves a null value null without decoding", () => {
    const { resolve } = select([]);

    expect(resolve([{ id: "c1", subject_id: null, subject_type: null, body: null }])).toEqual([
      { $$meta: table.meta, id: "c1", subjectType: null, subjectId: null, body: null },
    ]);
  });
});

describe("union joins — results", () => {
  const { resolve } = select([
    ["feed", { members: all("photos", "videos") }],
    ["latest", { members: all("photos", "videos") }],
  ]);

  const photoRow = {
    $$key: "photos",
    id: "p1",
    user_id: "u1",
    created_at: "2026-01-01T00:00:00Z",
    photo_url: "a.jpg",
    __o0: "ignored",
  };
  const videoRow = {
    $$key: "videos",
    id: "v1",
    owner_id: "u1",
    created_at: "2026-01-02T00:00:00Z",
    video_url: "b.mp4",
  };

  it("dispatches every row to its member's resolvers and tags it with $$key", () => {
    const result = resolve([{ id: "u1", feed: [photoRow, videoRow], latest: videoRow }]);

    expect(result?.feed).toEqual([
      {
        $$key: "photos",
        $$meta: { key: "photos", table: "photos", __typename: "Photo" },
        id: "p1",
        userId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
        photoUrl: "a.jpg",
      },
      {
        $$key: "videos",
        $$meta: { key: "videos", table: "videos" },
        id: "v1",
        userId: "u1",
        createdAt: "2026-01-02T00:00:00Z",
        videoUrl: "b.mp4",
      },
    ]);
    expect((result?.latest as Record<string, unknown>)?.$$key).toBe("videos");
  });

  it("answers an empty has-many with [] and a missing has-one with null", () => {
    const result = resolve([{ id: "u1", feed: [], latest: null }]);

    expect(result?.feed).toEqual([]);
    expect(result?.latest).toBeNull();
  });

  it("throws on a row naming a member the query did not select", () => {
    const { resolve: videosOnly } = select([["feed", { members: all("videos") }]]);

    expect(() => videosOnly([{ id: "u1", feed: [photoRow] }])).toThrow(
      /names member "photos", which this query did not select \(selected: videos\)/
    );
  });
});

describe("union joins — tenancy", () => {
  const ws = new TenantScopeDefinition({
    workspaceId: col("workspace_id", "uuid").notNull(),
  });

  const notes = ws.table("notes", {
    id: col("id", "uuid").primaryKey(),
    userId: col("user_id", "uuid"),
  });

  const links = new TableDefinition("links", {
    columns: { id: col("id", "uuid").primaryKey(), userId: col("user_id", "uuid") },
  });

  const items = new UnionDefinition({ notes, links });

  const rels = new RelationsDefinition(users, {
    items: {
      type: Relation.HAS_MANY,
      target: items,
      from: [users.columns.id],
      to: [items.columns.userId],
    },
  });

  const scoped = new SchemaRegistry({ users, notes, links, items, rels });
  const build = (identity?: Record<string, unknown>) =>
    new OperationsFactory(
      new ExecutionContext({
        schema: scoped,
        dialect: new QueryBuilder(),
        session: { execute: vi.fn() },
        identity,
      })
    ).createSelectOperation(scoped.getTable("users"), {
      mode: "many",
      args: { select: [], join: [["items", { members: all("notes", "links") }]] },
    });

  it("applies the tenant predicate inside the scoped member's branch only", () => {
    const { query } = build({ workspaceId: "w1" });

    expect(query.text).toContain(
      'FROM "notes" AS "__t1" WHERE "__t1"."user_id" = "__t0"."id" AND ("__t1"."workspace_id" = $1)'
    );
    expect(query.text).toContain('FROM "links" AS "__t2" WHERE "__t2"."user_id" = "__t0"."id")');
  });

  it("refuses the union when a member is scoped and the client carries no claims", () => {
    expect(() => build()).toThrow(TenancyError);
  });
});

describe("top-level union select", () => {
  const union = registry.getUnion("posts");
  const run = (
    args: Omit<UnionSelectOperationArgs, "members"> & {
      members?: UnionSelectOperationArgs["members"];
    },
    mode: "one" | "many" = "many"
  ) =>
    factory.createUnionSelectOperation(union, {
      mode,
      args: { members: all("photos", "videos"), ...args },
    });

  it("renders the union at the root, ordered and limited across members", () => {
    const { query } = run({ orderBy: [{ field: "createdAt", direction: "desc" }], limit: 10 });

    expect(query.text).toMatch(
      /^SELECT row_to_json\("__j0"\.\*\) AS "data", "__j0"\."__o0", "__j0"\."\$\$key", "__j0"\."__pk0" FROM \(SELECT 'photos' AS "\$\$key"/
    );
    expect(query.text).toMatch(/UNION ALL SELECT row_to_json\("__j1"\.\*\)/);
    expect(query.text).toMatch(/ORDER BY "__o0" DESC, "\$\$key" ASC, "__pk0" ASC LIMIT \$3$/);
    expect(query.params).toEqual([10, 10, 10]);
  });

  it("resolves each row's data by its member", () => {
    const { resolve } = run({});
    const rows = resolve([
      { data: { $$key: "videos", id: "v1", owner_id: "u1", created_at: "t", video_url: "b" } },
    ]) as Record<string, unknown>[];

    expect(rows[0]).toEqual({
      $$key: "videos",
      $$meta: { key: "videos", table: "videos" },
      id: "v1",
      userId: "u1",
      createdAt: "t",
      videoUrl: "b",
    });
  });

  it("reads one row for findOne", () => {
    const { query, resolve } = run({}, "one");

    expect(query.text).toMatch(/LIMIT \$\d+$/);
    expect(resolve([])).toBeNull();
  });

  it("reads nothing when no member runs", () => {
    const { query, resolve } = run({ members: [] });

    expect(query.text).toBe('SELECT NULL::json AS "data" WHERE false');
    expect(resolve([])).toEqual([]);
  });

  describe("keyset", () => {
    it("projects the total order as hidden text keys and carries them", () => {
      const { query } = run({
        orderBy: [{ field: "createdAt", direction: "desc" }],
        keys: true,
        tiebreak: "desc",
      });

      expect(query.text).toContain(
        `'photos'::text AS "__k1", "__t0"."id"::text AS "__k2" FROM "photos"`
      );
      expect(query.text).toContain('"__t0"."created_at"::text AS "__k0"');
      expect(query.text).toContain('"__j0"."__k0", "__j0"."__k1", "__j0"."__k2" FROM');
      expect(query.text).toMatch(/ORDER BY "__o0" DESC, "\$\$key" DESC, "__pk0" DESC$/);
    });

    it("orders by $$key and the primary key when paged with no orderBy", () => {
      const { query } = run({ keys: true });

      expect(query.text).toMatch(/ORDER BY "\$\$key" ASC, "__pk0" ASC$/);
    });

    it("applies the keyset inside each branch, where $$key is a constant", () => {
      const { query } = run({
        orderBy: [{ field: "createdAt", direction: "desc" }],
        keyset: { values: ["2026-01-01", "photos", "p1"], bound: "after" },
        limit: 3,
      });

      expect(query.text).toContain(
        `FROM "photos" AS "__t0" WHERE "__t0"."created_at" < $1 OR ("__t0"."created_at" = $2 AND ('photos' > $3 OR ('photos' = $4 AND "__t0"."id" > $5))) ORDER BY`
      );
      expect(query.text).toContain(
        `FROM "videos" AS "__t1" WHERE "__t1"."created_at" < $7 OR ("__t1"."created_at" = $8 AND ('videos' > $9`
      );
    });

    it("reverses every key, pushdown included, for a page before the cursor", () => {
      const { query } = run({
        orderBy: [{ field: "createdAt", direction: "desc" }],
        keyset: { values: ["2026-01-01", "photos", "p1"], bound: "before" },
        limit: 3,
      });

      expect(query.text).toContain(
        'WHERE "__t0"."created_at" > $1 OR ("__t0"."created_at" = $2 AND (\'photos\' < $3'
      );
      expect(query.text).toContain('ORDER BY "__t0"."created_at" ASC, "__t0"."id" DESC LIMIT');
      expect(query.text).toMatch(/ORDER BY "__o0" ASC, "\$\$key" DESC, "__pk0" DESC LIMIT \$\d+$/);
    });

    it("refuses to page a union whose members' keys do not line up", () => {
      const composite = new TableDefinition("composite", {
        columns: { a: col("a", "uuid"), b: col("b", "uuid"), userId: col("user_id", "uuid") },
      });
      composite.primaryKey((c) => [c.a, c.b]);

      const mixed = new UnionDefinition({ photos, composite });
      const schema = new SchemaRegistry({ photos, composite, mixed });
      const mixedFactory = new OperationsFactory(
        new ExecutionContext({ schema, dialect: new QueryBuilder(), session: { execute: vi.fn() } })
      );

      expect(() =>
        mixedFactory.createUnionSelectOperation(schema.getUnion("mixed"), {
          mode: "many",
          args: { members: all("photos", "composite"), keys: true },
        })
      ).toThrow(/Cannot page union "mixed": its members' primary keys differ/);

      // Unpaged, it still orders — by $$key alone, with no primary-key tiebreaker.
      const { query } = mixedFactory.createUnionSelectOperation(schema.getUnion("mixed"), {
        mode: "many",
        args: {
          members: all("photos", "composite"),
          orderBy: [{ field: "userId", direction: "asc" }],
        },
      });

      expect(query.text).toMatch(/ORDER BY "__o0" ASC, "\$\$key" ASC$/);
    });
  });

  describe("count", () => {
    it("adds one count per member, each through the WHERE seam", () => {
      const photosTable = registry.getTable("photos");
      const { query, resolve } = factory.createUnionCountOperation(union, {
        mode: "one",
        args: {
          members: [
            ["photos", { where: sql.eq(photosTable.columns.photoUrl, "x") }],
            ["videos", {}],
          ],
        },
      });

      expect(query.text).toBe(
        'SELECT (SELECT count(*) FROM "photos" AS "__t0" WHERE "__t0"."photo_url" = $1) + ' +
          '(SELECT count(*) FROM "videos" AS "__t0") AS "count"'
      );
      expect(resolve([{ count: "7" }])).toBe(7);
    });

    it("is zero with no member", () => {
      const { query } = factory.createUnionCountOperation(union, {
        mode: "one",
        args: { members: [] },
      });

      expect(query.text).toBe('SELECT 0 AS "count"');
    });
  });
});
