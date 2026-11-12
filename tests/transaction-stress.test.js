import test from "node:test";
import assert from "node:assert/strict";
import { withTransaction, getPool } from "../server/db.js";
import handler from "../api/[...path].js";
import { createSessionCookie } from "../server/auth.js";
import { approveCourse } from "../server/plan-service.js";

// Ensure DATABASE_URL and SESSION_SECRET are set so getPool() and auth can initialize
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/drizzlearn_test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-that-is-at-least-32-characters";

async function callApi({ path, method = "GET", body, headers = {} }) {
  const responseHeaders = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { responseHeaders.set(name.toLowerCase(), value); },
    end(value = "") { this.body = value; },
  };
  const request = {
    url: `/api/${path}`,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  };
  await handler(request, response);
  return {
    status: response.statusCode,
    headers: responseHeaders,
    json: response.body ? JSON.parse(response.body) : null,
  };
}

test("Database Transaction & Rollback Stress Verification", async (t) => {
  const pool = getPool();
  const originalConnect = pool.connect;
  const originalQuery = pool.query;

  t.after(() => {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  });

  await t.test("Atomicity: withTransaction commits on success and releases client cleanly", async () => {
    const queries = [];
    let releasedWith = "NOT_CALLED";

    const mockClient = {
      query: async (sql) => {
        queries.push(typeof sql === "string" ? sql.trim() : sql);
        return { rows: [{ ok: true }] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    const result = await withTransaction(async (client) => {
      await client.query("SELECT 1");
      return "WORK_SUCCESS";
    });

    assert.equal(result, "WORK_SUCCESS");
    assert.deepEqual(queries, ["BEGIN", "SELECT 1", "COMMIT"]);
    assert.equal(releasedWith, undefined, "Healthy client must be released without error argument");
  });

  await t.test("Atomicity: withTransaction rolls back on work failure and preserves original error", async () => {
    const queries = [];
    let releasedWith = "NOT_CALLED";
    const expectedError = new Error("Work execution query failed");

    const mockClient = {
      query: async (sql) => {
        queries.push(sql.trim());
        return { rows: [] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await withTransaction(async (client) => {
          await client.query("UPDATE sample SET x = 1");
          throw expectedError;
        });
      },
      (err) => {
        assert.equal(err, expectedError, "Original error must be re-thrown");
        assert.equal(err.cause, undefined, "No cause when rollback succeeds");
        return true;
      }
    );

    assert.deepEqual(queries, ["BEGIN", "UPDATE sample SET x = 1", "ROLLBACK"]);
    assert.equal(releasedWith, undefined, "Client released cleanly after successful rollback");
  });

  await t.test("Rollback Resilience: withTransaction preserves original error and sets error.cause on rollback failure", async () => {
    const queries = [];
    let releasedWith = "NOT_CALLED";
    const workError = new Error("Primary database query failed");
    const rollbackError = new Error("Connection reset by peer during rollback");

    const mockClient = {
      query: async (sql) => {
        const trimmed = sql.trim();
        queries.push(trimmed);
        if (trimmed === "ROLLBACK") {
          throw rollbackError;
        }
        return { rows: [] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await withTransaction(async (client) => {
          await client.query("INSERT INTO test VALUES (1)");
          throw workError;
        });
      },
      (err) => {
        assert.equal(err, workError, "Must preserve root error, not mask with rollback error");
        assert.equal(err.cause, rollbackError, "error.cause must contain the rollback error");
        return true;
      }
    );

    assert.deepEqual(queries, ["BEGIN", "INSERT INTO test VALUES (1)", "ROLLBACK"]);
    assert.equal(releasedWith, rollbackError, "Broken connection must be evicted with rollback error");
  });

  await t.test("Rollback Resilience: preserves pre-existing error.cause when rollback fails", async () => {
    let releasedWith = "NOT_CALLED";
    const initialCause = new Error("Root hardware disk error");
    const workError = new Error("Service layer error", { cause: initialCause });
    const rollbackError = new Error("Network timeout during rollback");

    const mockClient = {
      query: async (sql) => {
        if (sql.trim() === "ROLLBACK") throw rollbackError;
        return { rows: [] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await withTransaction(async () => {
          throw workError;
        });
      },
      (err) => {
        assert.equal(err, workError);
        assert.equal(err.cause, initialCause, "Pre-existing error.cause must not be overwritten");
        return true;
      }
    );

    assert.equal(releasedWith, rollbackError);
  });

  await t.test("Rollback Resilience: safely handles non-standard errors (primitives and frozen objects)", async () => {
    const rollbackError = new Error("Rollback failed");

    const mockClient = {
      query: async (sql) => {
        if (sql.trim() === "ROLLBACK") throw rollbackError;
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    // Primitive string error
    await assert.rejects(
      async () => {
        await withTransaction(async () => {
          throw "primitive string error";
        });
      },
      (err) => {
        assert.equal(err, "primitive string error");
        return true;
      }
    );

    // Frozen Error object (setting .cause directly would throw TypeError in strict mode)
    const frozenError = Object.freeze(new Error("Frozen error message"));
    await assert.rejects(
      async () => {
        await withTransaction(async () => {
          throw frozenError;
        });
      },
      (err) => {
        assert.equal(err, frozenError);
        return true;
      }
    );
  });

  await t.test("Commit Failure: attempts ROLLBACK and chains rollback error if COMMIT throws", async () => {
    const queries = [];
    let releasedWith = "NOT_CALLED";
    const commitError = new Error("Deferred constraint violation on COMMIT");
    const rollbackError = new Error("Broken pipe during rollback");

    const mockClient = {
      query: async (sql) => {
        const trimmed = sql.trim();
        queries.push(trimmed);
        if (trimmed === "COMMIT") throw commitError;
        if (trimmed === "ROLLBACK") throw rollbackError;
        return { rows: [] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await withTransaction(async (client) => {
          await client.query("SELECT 1");
          return "ok";
        });
      },
      (err) => {
        assert.equal(err, commitError, "Commit failure must be preserved as root error");
        assert.equal(err.cause, rollbackError, "Rollback failure must be chained in error.cause");
        return true;
      }
    );

    assert.deepEqual(queries, ["BEGIN", "SELECT 1", "COMMIT", "ROLLBACK"]);
    assert.equal(releasedWith, rollbackError, "Evicts broken connection after rollback failure");
  });

  await t.test("Begin Failure: handles ROLLBACK and evicts connection if BEGIN throws", async () => {
    let releasedWith = "NOT_CALLED";
    const beginError = new Error("Socket error on BEGIN");
    const rollbackError = new Error("Socket dead on ROLLBACK");

    const mockClient = {
      query: async (sql) => {
        const trimmed = sql.trim();
        if (trimmed === "BEGIN") throw beginError;
        if (trimmed === "ROLLBACK") throw rollbackError;
        return { rows: [] };
      },
      release: (err) => {
        releasedWith = err;
      },
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await withTransaction(async () => {});
      },
      (err) => {
        assert.equal(err, beginError);
        assert.equal(err.cause, rollbackError);
        return true;
      }
    );

    assert.equal(releasedWith, rollbackError);
  });

  await t.test("Auth Verify Atomicity: Token consumption rolls back if user update fails", async () => {
    const executedQueries = [];
    const validToken = "a".repeat(32); // 32 characters, valid length
    const userUpdateError = new Error("Database crashed during users email_verified_at update");

    const mockClient = {
      query: async (sql, params) => {
        const trimmed = sql.trim();
        executedQueries.push({ sql: trimmed, params });
        if (trimmed.startsWith("UPDATE auth_tokens")) {
          // Token query succeeds and returns user_id
          return { rows: [{ user_id: "55555555-5555-4555-8555-555555555555" }] };
        }
        if (trimmed.startsWith("UPDATE users")) {
          // Simulating failure on second statement
          throw userUpdateError;
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    const result = await callApi({
      path: "auth/verify",
      method: "POST",
      body: { token: validToken },
    });

    // Verify endpoint failed with 500 (safeError)
    assert.equal(result.status, 500, "Must return 500 when database transaction fails");
    assert.equal(result.json.error.code, "INTERNAL_ERROR");

    // Verify the query sequence: BEGIN -> UPDATE auth_tokens -> UPDATE users -> ROLLBACK
    const queryTypes = executedQueries.map((q) => q.sql.split(" ")[0]);
    assert.deepEqual(queryTypes, ["BEGIN", "UPDATE", "UPDATE", "ROLLBACK"]);
    assert.ok(!queryTypes.includes("COMMIT"), "COMMIT must NEVER be called when statement fails");
  });

  await t.test("Auth Verify: Invalid/expired token does not attempt user update", async () => {
    const executedQueries = [];
    const validToken = "b".repeat(32);

    const mockClient = {
      query: async (sql, params) => {
        const trimmed = sql.trim();
        executedQueries.push({ sql: trimmed, params });
        if (trimmed.startsWith("UPDATE auth_tokens")) {
          // Token expired or not found -> 0 rows
          return { rows: [] };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    const result = await callApi({
      path: "auth/verify",
      method: "POST",
      body: { token: validToken },
    });

    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_TOKEN");

    const userQueries = executedQueries.filter((q) => q.sql.includes("UPDATE users"));
    assert.equal(userQueries.length, 0, "Must not attempt user update when token not found");
  });

  await t.test("Auth Reset Password Atomicity: Token consumption rolls back if user password update fails", async () => {
    const executedQueries = [];
    const validToken = "c".repeat(32);
    const validPassword = "newPassword123!";
    const passwordUpdateError = new Error("Database deadlock during password_hash update");

    const mockClient = {
      query: async (sql, params) => {
        const trimmed = sql.trim();
        executedQueries.push({ sql: trimmed, params });
        if (trimmed.startsWith("UPDATE auth_tokens")) {
          return { rows: [{ user_id: "66666666-6666-4666-8666-666666666666" }] };
        }
        if (trimmed.startsWith("UPDATE users")) {
          throw passwordUpdateError;
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    const result = await callApi({
      path: "auth/reset-password",
      method: "POST",
      body: { token: validToken, password: validPassword },
    });

    assert.equal(result.status, 500);
    assert.equal(result.json.error.code, "INTERNAL_ERROR");

    const queryTypes = executedQueries.map((q) => q.sql.split(" ")[0]);
    assert.deepEqual(queryTypes, ["BEGIN", "UPDATE", "UPDATE", "ROLLBACK"]);
    assert.ok(!queryTypes.includes("COMMIT"), "COMMIT must NEVER be called on failed reset");
  });

  await t.test("Course Status Synchronization: PUT /api/courses/:id rolls back when goal update fails", async () => {
    const executedQueries = [];
    const testUserId = "77777777-7777-4777-8777-777777777777";
    const testCourseId = "88888888-8888-4888-8888-888888888888";
    const cookie = createSessionCookie(testUserId);

    // Mock pool.query for authentication requireUser check
    pool.query = async (sql, params) => {
      if (sql.includes("FROM users WHERE id = $1")) {
        return {
          rows: [{
            id: testUserId,
            email: "course-tester@example.com",
            full_name: "Course Tester",
            timezone: "UTC",
            preferred_study_days: [1, 3, 5],
            session_minutes: 45,
            weekly_minutes: 360,
            notification_preferences: {},
          }],
        };
      }
      return { rows: [] };
    };

    // Mock client for transaction
    const mockClient = {
      query: async (sql, params) => {
        const trimmed = sql.trim();
        executedQueries.push({ sql: trimmed, params });
        if (trimmed.startsWith("UPDATE courses")) {
          return { rows: [{ id: testCourseId, goal_id: "goal-1", title: "Updated Title", summary: "Updated summary" }] };
        }
        if (trimmed.startsWith("UPDATE learning_goals")) {
          throw new Error("Goal table update failure");
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    const result = await callApi({
      path: `courses/${testCourseId}`,
      method: "PUT",
      body: { title: "Updated Title", summary: "Updated summary", status: "active" },
      headers: { cookie },
    });

    assert.equal(result.status, 500);
    assert.equal(result.json.error.code, "INTERNAL_ERROR");

    const queryTypes = executedQueries.map((q) => q.sql.split(" ")[0]);
    assert.deepEqual(queryTypes, ["BEGIN", "UPDATE", "UPDATE", "ROLLBACK"]);
    assert.ok(!queryTypes.includes("COMMIT"), "Courses update must roll back when goal update fails");
  });

  await t.test("Course Approval Atomicity: approveCourse rolls back when study task insert fails", async () => {
    const executedQueries = [];
    const testUserId = "77777777-7777-4777-8777-777777777777";
    const testCourseId = "99999999-9999-4999-8999-999999999999";

    const mockClient = {
      query: async (sql, params) => {
        const trimmed = sql.trim();
        executedQueries.push(trimmed);
        if (trimmed.includes("FROM courses c JOIN learning_goals g")) {
          return {
            rows: [{
              id: testCourseId,
              goal_id: "goal-1",
              status: "proposal",
              target_weeks: 4,
              weekly_minutes: 180,
              estimated_minutes: 120,
            }],
          };
        }
        if (trimmed.startsWith("SELECT id,position,estimated_minutes FROM course_modules")) {
          return { rows: [{ id: "mod-1", position: 1, estimated_minutes: 120 }] };
        }
        if (trimmed.startsWith("UPDATE courses SET status='active'")) {
          return { rows: [] };
        }
        if (trimmed.startsWith("UPDATE learning_goals SET status='active'")) {
          return { rows: [] };
        }
        if (trimmed.startsWith("SELECT id,title,estimated_minutes,module_id FROM lessons")) {
          return { rows: [{ id: "lesson-1", title: "Lesson 1", estimated_minutes: 30, module_id: "mod-1" }] };
        }
        if (trimmed.startsWith("INSERT INTO study_tasks")) {
          throw new Error("Disk full while inserting study_tasks");
        }
        return { rows: [] };
      },
      release: () => {},
    };

    pool.connect = async () => mockClient;

    await assert.rejects(
      async () => {
        await approveCourse(testUserId, testCourseId, true, {
          preferred_study_days: [1, 3],
          session_minutes: 60,
          weekly_minutes: 180,
        });
      },
      (err) => {
        assert.equal(err.message, "Disk full while inserting study_tasks");
        return true;
      }
    );

    assert.ok(executedQueries.includes("ROLLBACK"), "ROLLBACK must be issued on task scheduling failure");
    assert.ok(!executedQueries.includes("COMMIT"), "COMMIT must NEVER be issued on task scheduling failure");
  });

  await t.test("Concurrency & Eviction Stress: 100 interleaved operations guarantee connection release and cause chaining", async () => {
    let connectCount = 0;
    let releaseCount = 0;
    let evictedCount = 0;
    let cleanReleaseCount = 0;

    pool.connect = async () => {
      connectCount++;
      return {
        query: async (sql) => {
          const trimmed = sql.trim();
          if (trimmed.startsWith("FAIL_ROLLBACK")) {
            throw new Error("Simulated rollback crash");
          }
          if (trimmed.startsWith("FAIL_COMMIT")) {
            throw new Error("Simulated commit crash");
          }
          return { rows: [] };
        },
        release: (err) => {
          releaseCount++;
          if (err) evictedCount++;
          else cleanReleaseCount++;
        },
      };
    };

    const tasks = [];

    // 25 Successful transactions
    for (let i = 0; i < 25; i++) {
      tasks.push(
        withTransaction(async (c) => {
          await c.query("SELECT 1");
          return i;
        })
      );
    }

    // 25 Work error + successful rollback
    for (let i = 0; i < 25; i++) {
      tasks.push(
        withTransaction(async (c) => {
          await c.query("SELECT 1");
          throw new Error(`Work failure ${i}`);
        }).catch((err) => {
          assert.equal(err.message, `Work failure ${i}`);
          assert.equal(err.cause, undefined);
          return "caught_work_error";
        })
      );
    }

    // 25 Work error + failing rollback
    for (let i = 0; i < 25; i++) {
      tasks.push(
        withTransaction(async (c) => {
          // Trigger rollback failure by instructing mock client
          c.query = async (sql) => {
            if (sql.trim() === "ROLLBACK") throw new Error(`Rollback failure ${i}`);
            return { rows: [] };
          };
          throw new Error(`Work failure ${i}`);
        }).catch((err) => {
          assert.equal(err.message, `Work failure ${i}`);
          assert.equal(err.cause?.message, `Rollback failure ${i}`);
          return "caught_rollback_error";
        })
      );
    }

    // 25 Failing commit + failing rollback
    for (let i = 0; i < 25; i++) {
      tasks.push(
        withTransaction(async (c) => {
          c.query = async (sql) => {
            if (sql.trim() === "COMMIT") throw new Error(`Commit failure ${i}`);
            if (sql.trim() === "ROLLBACK") throw new Error(`Rollback failure ${i}`);
            return { rows: [] };
          };
          return "done";
        }).catch((err) => {
          assert.equal(err.message, `Commit failure ${i}`);
          assert.equal(err.cause?.message, `Rollback failure ${i}`);
          return "caught_commit_error";
        })
      );
    }

    const results = await Promise.all(tasks);
    assert.equal(results.length, 100);

    // Verify all connections were released (NO LEAKS)
    assert.equal(connectCount, 100, "Must connect 100 times");
    assert.equal(releaseCount, 100, "All 100 connections must be released (zero pool leaks)");
    assert.equal(cleanReleaseCount, 50, "50 successful operations (25 commits + 25 clean rollbacks) released cleanly");
    assert.equal(evictedCount, 50, "50 rollback failures must be evicted with error argument");
  });
});
