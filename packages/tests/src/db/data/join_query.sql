SELECT 
  "projects"."id", 
  "projects"."team_id", 
  "projects"."name", 
  "projects"."is_archived", 
  "__join_tasks"."data" AS "tasks" 
FROM "projects" 
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" 
    FROM (
      SELECT 
        "tasks"."id", 
        "tasks"."title", 
        "tasks"."description", 
        "__join_assignee"."data" AS "assignee" 
      FROM "tasks" 
      LEFT JOIN LATERAL (
        SELECT row_to_json("__t".*) AS "data" 
        FROM (
          SELECT "users"."id", "users"."name", "users"."email" 
          FROM "users" 
          WHERE "tasks"."assignee_id" = "users"."id" LIMIT $1
        ) AS "__t") AS "__join_assignee" 
      ON true 
      WHERE "tasks"."project_id" = "projects"."id" AND ("tasks"."due_date" < $2) 
      ORDER BY "tasks"."due_date" ASC 
      LIMIT $3
    ) 
  AS "__t") AS "__join_tasks" 
  ON true 
  WHERE (
    ("projects"."name" LIKE $4 OR "projects"."name" LIKE $5) 
    AND "projects"."is_archived" <> $6
  )