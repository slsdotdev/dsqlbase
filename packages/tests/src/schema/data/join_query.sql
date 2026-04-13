SELECT "users"."id", "users"."name", "__join_tasks"."data" AS "tasks" 
FROM "users" 
LEFT JOIN LATERAL (
  SELECT COALESCE(json_agg(row_to_json("__t".*)), '[]'::json) AS "data" 
  FROM (
    SELECT "tasks"."title", "tasks"."due_date", "__join_project"."data" AS "project" 
    FROM "tasks" 
    LEFT JOIN LATERAL (
      SELECT row_to_json("__t".*) AS "data" 
      FROM (
        SELECT "projects"."name" 
        FROM "projects" 
        WHERE "projects"."id" = "tasks"."project_id"
      ) AS "__t"
    ) AS "__join_project" ON true 
    WHERE "tasks"."assignee_id" = "users"."id" AND "tasks"."completed_at" IS NULL
  ) AS "__t"
) AS "__join_tasks" ON true 
WHERE "users"."id" = $1