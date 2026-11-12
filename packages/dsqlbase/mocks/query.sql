SELECT 
  "__t0"."id", 
  "__t0"."name", 
  "__join_posts"."data" AS "posts", 
  "__join_feed"."data" AS "feed" 
FROM 
  "users" AS "__t0" 
  LEFT JOIN lateral (
    select 
      COALESCE(
        json_agg(
          row_to_json("__j0".*)
        ), 
        '[]' :: json
      ) AS "data" 
    FROM 
      (
        SELECT 
          "__t1"."id", 
          "__t1"."author_id", 
          "__t1"."media_id", 
          CASE WHEN EXISTS (
            SELECT 
              1 
            FROM 
              "photos" AS "__d0" 
            WHERE 
              "__d0"."id" = "__t1"."media_id"
          ) THEN 'photos' WHEN EXISTS (
            SELECT 
              1 
            FROM 
              "videos" AS "__d1" 
            WHERE 
              "__d1"."id" = "__t1"."media_id"
          ) THEN 'videos' END AS "media_id$key", 
          "__t1"."title", 
          "__t1"."content", 
          "__join_comments"."data" AS "comments" 
        FROM 
          "posts" AS "__t1" 
          LEFT JOIN lateral (
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
                  LEFT JOIN lateral (
                    SELECT 
                      row_to_json("__j2".*) AS "data" 
                    FROM 
                      (
                        SELECT 
                          "__t3"."id", 
                          "__t3"."name", 
                          "__join_posts"."data" AS "posts" 
                        FROM 
                          "users" AS "__t3" 
                          LEFT JOIN lateral (
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
                                  "__t4"."id", 
                                  "__t4"."author_id", 
                                  "__t4"."media_id", 
                                  CASE WHEN EXISTS (
                                    SELECT 
                                      1 
                                    FROM 
                                      "photos" AS "__d0" 
                                    WHERE 
                                      "__d0"."id" = "__t4"."media_id"
                                  ) THEN 'photos' WHEN EXISTS (
                                    SELECT 
                                      1 
                                    FROM 
                                      "videos" AS "__d1" 
                                    WHERE 
                                      "__d1"."id" = "__t4"."media_id"
                                  ) THEN 'videos' END AS "media_id$key", 
                                  "__t4"."title", 
                                  "__t4"."content", 
                                  "__join_comments"."data" AS "comments", 
                                  "__join_author"."data" AS "author" 
                                FROM 
                                  "posts" AS "__t4" 
                                  LEFT JOIN lateral (
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
                                  LEFT JOIN lateral (
                                    SELECT 
                                      row_to_json("__j5".*) AS "data" 
                                    FROM 
                                      (
                                        SELECT 
                                          "__t6"."id", 
                                          "__t6"."name", 
                                          "__join_feed"."data" AS "feed" 
                                        FROM 
                                          "users" AS "__t6" 
                                          LEFT JOIN lateral (
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
                                                      'photos' AS "$$key", 
                                                      "__t7"."id", 
                                                      "__t7"."user_id", 
                                                      "__t7"."created_at", 
                                                      "__t7"."photo_url" 
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
                                                      'videos' AS "$$key", 
                                                      "__t8"."id", 
                                                      "__t8"."user_id", 
                                                      "__t8"."created_at", 
                                                      "__t8"."video_url" 
                                                    FROM 
                                                      "videos" AS "__t8" 
                                                    WHERE 
                                                      "__t8"."user_id" = "__t6"."id"
                                                  ) AS "__j7"
                                              ) AS "__u0"
                                          ) AS "__join_feed" ON true 
                                        WHERE 
                                          "__t6"."id" = "__t4"."author_id" 
                                        limit 
                                          $1
                                      ) AS "__j5"
                                  ) AS "__join_author" ON true 
                                WHERE 
                                  "__t4"."author_id" = "__t3"."id"
                              ) AS "__j3"
                          ) AS "__join_posts" ON true 
                        WHERE 
                          "__t3"."id" = "__t2"."author_id" 
                        limit 
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
  LEFT JOIN lateral (
    SELECT 
      COALESCE(
        json_agg("__u1"."data"), 
        '[]' :: json
      ) AS "data" 
    FROM 
      (
        SELECT 
          row_to_json("__j8".*) AS "data" 
        FROM 
          (
            SELECT 
              'photos' AS "$$key", 
              "__t9"."id", 
              "__t9"."photo_url" 
            FROM 
              "photos" AS "__t9" 
            WHERE 
              "__t9"."user_id" = "__t0"."id"
          ) AS "__j8" 
        UNION ALL 
        SELECT 
          row_to_json("__j10".*) AS "data" 
        FROM 
          (
            SELECT 
              'videos' AS "$$key", 
              "__t10"."id", 
              "__t10"."video_url", 
              "__join_owner"."data" AS "owner" 
            FROM 
              "videos" AS "__t10" 
              LEFT JOIN lateral (
                SELECT 
                  row_to_json("__j9".*) AS "data" 
                FROM 
                  (
                    SELECT 
                      "__t11"."id" 
                    FROM 
                      "users" AS "__t11" 
                    WHERE 
                      "__t11"."id" = "__t10"."user_id" 
                    limit 
                      $3
                  ) AS "__j9"
              ) AS "__join_owner" ON true 
            WHERE 
              "__t10"."user_id" = "__t0"."id"
          ) AS "__j10"
      ) AS "__u1"
  ) AS "__join_feed" ON true 
WHERE 
  "__t0"."id" = $4 
limit 
  $5
