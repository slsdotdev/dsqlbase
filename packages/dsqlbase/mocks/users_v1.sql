SELECT 
  "__t0"."id", 
  "__t0"."name", 
  "__join_posts"."data" AS "posts" 
FROM 
  "users" AS "__t0" 
  LEFT JOIN LATERAL (
    SELECT 
      COALESCE(
        json_agg(
          row_to_json("__j0".*)
        ), 
        '[]' :: json
      ) AS "data" 
    FROM 
      (
        SELECT 
          "__join_comments"."data" AS "comments" 
        FROM 
          "posts" AS "__t1" 
          LEFT JOIN LATERAL (
            SELECT 
              COALESCE(
                json_agg(
                  row_to_json("__j1".*)
                ), 
                '[]' :: json
              ) AS "data" 
            FROM 
              (
                SELECT 
                  "__t2"."id", 
                  "__join_author"."data" AS "author" 
                FROM 
                  "comments" AS "__t2" 
                  LEFT JOIN LATERAL (
                    SELECT 
                      row_to_json("__j2".*) AS "data" 
                    FROM 
                      (
                        SELECT 
                          "__join_posts"."data" AS "posts" 
                        FROM 
                          "users" AS "__t3" 
                          LEFT JOIN LATERAL (
                            SELECT 
                              COALESCE(
                                json_agg(
                                  row_to_json("__j3".*)
                                ), 
                                '[]' :: json
                              ) AS "data" 
                            FROM 
                              (
                                SELECT 
                                  "__join_comments"."data" AS "comments", 
                                  "__join_author"."data" AS "author" 
                                FROM 
                                  "posts" AS "__t4" 
                                  LEFT JOIN LATERAL (
                                    SELECT 
                                      COALESCE(
                                        json_agg(
                                          row_to_json("__j4".*)
                                        ), 
                                        '[]' :: json
                                      ) AS "data" 
                                    FROM 
                                      (
                                        SELECT 
                                          "__t5"."id" 
                                        FROM 
                                          "comments" AS "__t5" 
                                        WHERE 
                                          "__t5"."post_id" = "__t4"."id"
                                      ) AS "__j4"
                                  ) AS "__join_comments" ON true 
                                  LEFT JOIN LATERAL (
                                    SELECT 
                                      row_to_json("__j5".*) AS "data" 
                                    FROM 
                                      (
                                        SELECT 
                                          "__join_feed"."data" AS "feed" 
                                        FROM 
                                          "users" AS "__t6" 
                                          LEFT JOIN LATERAL (
                                            SELECT 
                                              COALESCE(
                                                json_agg("__u0"."data"), 
                                                '[]' :: json
                                              ) AS "data" 
                                            FROM 
                                              (
                                                SELECT 
                                                  row_to_json("__j6".*) AS "data" 
                                                FROM 
                                                  (
                                                    SELECT 
                                                      'photos' AS "$$key" 
                                                    FROM 
                                                      "photos" AS "__t7" 
                                                    WHERE 
                                                      "__t7"."user_id" = "__t6"."id"
                                                  ) AS "__j6" 
                                                UNION ALL 
                                                SELECT 
                                                  row_to_json("__j7".*) AS "data" 
                                                FROM 
                                                  (
                                                    SELECT 
                                                      'videos' AS "$$key" 
                                                    FROM 
                                                      "videos" AS "__t8" 
                                                    WHERE 
                                                      "__t8"."user_id" = "__t6"."id"
                                                  ) AS "__j7"
                                              ) AS "__u0"
                                          ) AS "__join_feed" ON true 
                                        WHERE 
                                          "__t6"."id" = "__t4"."author_id" 
                                        LIMIT 
                                          $1
                                      ) AS "__j5"
                                  ) AS "__join_author" ON true 
                                WHERE 
                                  "__t4"."author_id" = "__t3"."id"
                              ) AS "__j3"
                          ) AS "__join_posts" ON true 
                        WHERE 
                          "__t3"."id" = "__t2"."author_id" 
                        LIMIT 
                          $2
                      ) AS "__j2"
                  ) AS "__join_author" ON true 
                WHERE 
                  "__t2"."post_id" = "__t1"."id"
              ) AS "__j1"
          ) AS "__join_comments" ON true 
        WHERE 
          "__t1"."author_id" = "__t0"."id"
      ) AS "__j0"
  ) AS "__join_posts" ON true 
WHERE 
  "__t0"."id" = $3 
LIMIT 
  $4
