# Claude Debug Packet: Admin Retrieval Auth + Smoke Test Usage

## 1) `server/routes.ts` — `/api/synthesis/test-retrieval`

```ts
  /** GET /api/synthesis/stats — live snapshot of the BM25 knowledge engine */
  app.get("/api/synthesis/stats", (req, res) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      const providedToken = req.get("x-admin-token");
      if (adminToken && providedToken !== undefined && providedToken !== adminToken) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      res.json({ success: true, stats: synthesisEngine.getStats() });
    } catch (e) {
      res
        .status(500)
        .json({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
    }
  });

  /**
   * POST /api/synthesis/test-retrieval — read-only retrieval debugger
   * Body: { userMessage: string, systemPrompt?: string, mode?: string, k?: number }
   */
  app.post("/api/synthesis/test-retrieval", (req, res) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      if (adminToken && req.get("x-admin-token") !== adminToken) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      const userMessage = typeof req.body?.userMessage === "string"
        ? req.body.userMessage.trim()
        : "";
      const systemPrompt = typeof req.body?.systemPrompt === "string"
        ? req.body.systemPrompt
        : "";
      const mode = typeof req.body?.mode === "string" && req.body.mode.trim().length > 0
        ? req.body.mode.trim()
        : "standard";
      const k = typeof req.body?.k === "number" && Number.isFinite(req.body.k)
        ? req.body.k
        : 8;

      if (!userMessage) {
        return res.status(400).json({
          success: false,
          error: "userMessage is required",
        });
      }

      const ownerScope = typeof req.body?.ownerScope === "string" && req.body.ownerScope.trim().length > 0
        ? req.body.ownerScope.trim()
        : null;
      const debug = synthesisEngine.debugRetrieve(systemPrompt, userMessage, mode, k, ownerScope);
      return res.json({ success: true, debug });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
```

### Notes for Claude:
- This route uses `req.get("x-admin-token")` and checks equality against `process.env.ADMIN_TOKEN?.trim()`.
- Express header lookups are case-insensitive, so `X-Admin-Token` and `x-admin-token` should both be valid.
- The 401 originates here, not in `synthesis-engine.ts` or `/api/chat`.
- The route does not use the `ownerScope` value in auth logic; it only passes it into `debugRetrieve()`.


## 2) `smoke-tests.ts` — admin header usage for retrieval and auth validation

```ts
  const adminHeaders: Record<string, string> = process.env.ADMIN_TOKEN
    ? { "x-admin-token": process.env.ADMIN_TOKEN }
    : {};
  if (!process.env.ADMIN_TOKEN) {
    console.log("   SKIPPED: ADMIN_TOKEN not set — retrieval scope debug requires admin auth");
    return;
  }

  const [a, b] = await Promise.all([
    createVerifiedSession("isolation_synth_a"),
    createVerifiedSession("isolation_synth_b"),
  ]);

  const uniqueQuery = `Tell me about the obsidian lighthouse code ${Date.now()} in one sentence.`;

  const learned = await req<any>("/api/chat", {
    method: "POST",
    headers: { "X-Session-ID": a.id },
    cookie: a.cookie,
    body: {
      message: uniqueQuery,
      mode: "standard",
      maxTokens: 250,
    },
    timeoutMs: 60000,
  });
  assert(learned.ok, `session A learning request failed: ${learned.status} ${JSON.stringify(learned.body).slice(0, 300)}`);

  const debugA = await req<any>("/api/synthesis/test-retrieval", {
    method: "POST",
    headers: adminHeaders,
    body: {
      userMessage: uniqueQuery,
      mode: "standard",
      ownerScope: a.id,
      k: 6,
    },
    timeoutMs: 30000,
  });
  const debugB = await req<any>("/api/synthesis/test-retrieval", {
    method: "POST",
    headers: adminHeaders,
    body: {
      userMessage: uniqueQuery,
      mode: "standard",
      ownerScope: b.id,
      k: 6,
    },
    timeoutMs: 30000,
  });

  assert(debugA.ok, `debugA failed: ${debugA.status} ${JSON.stringify(debugA.body).slice(0, 300)}`);
  assert(debugB.ok, `debugB failed: ${debugB.status} ${JSON.stringify(debugB.body).slice(0, 300)}`);
```

### Notes for Claude:
- The test uses `process.env.ADMIN_TOKEN` and sends it as lowercase `"x-admin-token"` via the smoke harness.
- The route currently rejects if `req.get("x-admin-token") !== adminToken`, so only exact token matches pass.
- If `API/health/learning` passes with the same runtime token but `/api/synthesis/test-retrieval` still fails, the mismatch is likely in how the running server process is started or the environment is loaded for that route.


## 3) Recommended check items

1. Confirm the server process has `ADMIN_TOKEN` set at runtime and that it is the same string as the smoke test env.
2. Confirm the smoke test request header is actually being sent in the same process execution.
3. Confirm there is no proxy or browser-based header rewrite stripping `x-admin-token` for POST bodies.
4. Confirm the route code and server were restarted after any edits.


## 4) Why this is the most likely bug

- `routes.ts` admin auth guard is the only code path returning 401 for `/api/synthesis/test-retrieval`.
- `synthesis-engine.ts` is only called after auth passes.
- `/api/chat/stream` and local synthesis logic are unrelated to this specific admin endpoint.


## 5) Additional failed smoke tests: local synthesis feedback + stream fallback

### `smoke-tests.ts` — local synthesis reinforcement via `/api/chat`
```ts
  await test("Local Synthesis [/api/chat]: exact retrieved records get reinforced", async () => {
    const sess = await createVerifiedSession("bone_marrow_chat");
    const query = "Explain how your local synthesis system balances core knowledge and creativity.";

    const beforeDebug = await req<any>("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: {
        userMessage: query,
        mode: "standard",
        k: 6,
      },
      timeoutMs: 30000,
    });
    assert(beforeDebug.ok, `before debug retrieval failed: ${beforeDebug.status} ${JSON.stringify(beforeDebug.body).slice(0, 300)}`);
    const beforeMatches = ((beforeDebug.body as any)?.debug?.matches ?? []) as any[];
    assert(beforeMatches.length > 0, "before debug retrieval returned no matches");
    const target = beforeMatches[0];
    const beforeBone = Number(target?.heuristicProfile?.bone ?? 0);
    const beforeMarrow = Number(target?.heuristicProfile?.marrow ?? 0);

    const first = await req<any>("/api/chat", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: {
        message: query,
        mode: "standard",
        maxTokens: 600,
      },
      timeoutMs: 60000,
    });
    assert(first.ok, `initial local synthesis request failed: ${first.status} ${JSON.stringify(first.body).slice(0, 300)}`);

    const feedback = await req<any>("/api/chat", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: {
        message: "that was great and smart and creative",
        mode: "standard",
        maxTokens: 300,
      },
      timeoutMs: 60000,
    });
    assert(feedback.ok, `feedback request failed: ${feedback.status} ${JSON.stringify(feedback.body).slice(0, 300)}`);

    const afterDebug = await req<any>("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: {
        userMessage: query,
        mode: "standard",
        k: 6,
      },
      timeoutMs: 30000,
    });
    assert(afterDebug.ok, `after debug retrieval failed: ${afterDebug.status} ${JSON.stringify(afterDebug.body).slice(0, 300)}`);
    const afterMatches = ((afterDebug.body as any)?.debug?.matches ?? []) as any[];
    const sameRecord = afterMatches.find((m) => m.id === target.id);
    assert(!!sameRecord, `target record ${target.id} missing after feedback`);
    const afterBone = Number(sameRecord?.heuristicProfile?.bone ?? 0);
    const afterMarrow = Number(sameRecord?.heuristicProfile?.marrow ?? 0);
    const afterSpine = Number(sameRecord?.heuristicProfile?.spine ?? 0);
    console.log(`   exact record heuristicProfile: bone ${beforeBone} -> ${afterBone}, marrow ${beforeMarrow} -> ${afterMarrow}, spine=${afterSpine}`);

    assert(afterBone >= beforeBone, "expected reinforced record bone score to stay same or increase");
    assert(afterMarrow >= beforeMarrow, "expected reinforced record marrow score to stay same or increase");
    assert(Number.isFinite(afterSpine), "after spine score is not finite");
  });
```

### `smoke-tests.ts` — stream fallback mirrored feedback
```ts
  await test("Local Synthesis [/api/chat/stream]: mirrored feedback loop survives SSE fallback path", async () => {
    const sess = await createVerifiedSession("bone_marrow_stream");

    const stream1 = await reqSSE("/api/chat/stream", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: {
        message: "Explain your seed-first local synthesis logic in a concise way.",
        mode: "standard",
        maxTokens: 500,
      },
      timeoutMs: 60000,
    });
    assert(stream1.ok, `initial stream request failed: ${stream1.status} ${stream1.text.slice(0, 300)}`);
    console.log(`   stream response preview: ${stream1.text.slice(0, 220).replace(/\n/g, " ")}`);

    const streamFeedback = await reqSSE("/api/chat/stream", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: {
        message: "not relevant and too bland",
        mode: "standard",
        maxTokens: 300,
      },
      timeoutMs: 60000,
    });
    assert(streamFeedback.ok, `stream feedback request failed: ${streamFeedback.status} ${streamFeedback.text.slice(0, 300)}`);

    const debug = await req<any>("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: {
        userMessage: "Explain your seed-first local synthesis logic in a concise way.",
        mode: "standard",
        k: 6,
      },
      timeoutMs: 30000,
    });
    assert(debug.ok, `stream debug retrieval failed: ${debug.status} ${JSON.stringify(debug.body).slice(0, 300)}`);
    const matches = ((debug.body as any)?.debug?.matches ?? []) as any[];
    assert(matches.length > 0, "heuristic matches missing after stream feedback");
    console.log(`   mirrored first match heuristicProfile: ${JSON.stringify(matches[0]?.heuristicProfile ?? null)}`);
  });
```

### `server/routes.ts` — `/api/health/learning` admin auth
```ts
  app.get("/api/health/learning", async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    const provided = req.headers["x-admin-token"];

    // Always 401 on bad/missing credentials — never reveal config state to unauthenticated callers
    if (
      !adminToken ||
      !adminToken.trim() ||
      !provided ||
      (Array.isArray(provided) ? provided[0] : (provided as string)).trim() !==
        adminToken.trim()
    ) {
      return res
        .status(401)
        .json({
          error: "Unauthorized: invalid or missing X-Admin-Token header.",
        });
    }

    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM learning_data)                          AS total_learning,
          (SELECT COUNT(*) FROM learning_data  WHERE session_id IS NULL) AS detached_learning,
          (SELECT COUNT(*) FROM long_term_memory)                       AS total_ltm,
          (SELECT COUNT(*) FROM long_term_memory WHERE session_id IS NULL) AS detached_ltm,
`);
```

### `smoke-tests.ts` — `API/health/learning` admin validation
```ts
  await test("Admin: No token → 401", async () => {
    const { status } = await req("/api/health/learning");
    assert(status === 401, `expected 401 with no token, got ${status}`);
    console.log(`   no-token → 401 ✓`);
  });

  await test("Admin: Wrong token → 401", async () => {
    const { status } = await req("/api/health/learning", {
      headers: { "X-Admin-Token": "smoke_test_wrong_token_xyz_99999" },
    });
    assert(status === 401, `expected 401 with wrong token, got ${status}`);
    console.log(`   wrong-token → 401 ✓`);
  });

  await test("Admin: Valid token → 200 with structured count schema", async () => {
    if (!ADMIN_TOKEN) {
      console.log("   ⚠️  ADMIN_TOKEN not set — skipping live auth check");
      return;
    }
    const { ok, body } = await req<any>("/api/health/learning", {
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    });
    assert(ok, `valid token rejected: ${JSON.stringify(body)}`);
    assert(body.success === true, "success !== true");
    assert(body.antiCascadeProtocol === "active",
      `antiCascadeProtocol must be 'active', got: ${body.antiCascadeProtocol}`);
    const ld = body.learningData;
    const ltm = body.longTermMemory;
    assert(typeof ld.total === "number" && ld.total >= 0, `learningData.total invalid`);
    assert(ld.total === ld.detachedFromDeletedSessions + ld.linkedToActiveSessions,
      "learningData counts don't add up");
    assert(ltm.total === ltm.detachedFromDeletedSessions + ltm.linkedToActiveSessions,
      "longTermMemory counts don't add up");
    assert(body.summary.totalPreservedRecords === ld.total + ltm.total, "summary total mismatch");
    console.log(`   anti-cascade: ${body.antiCascadeProtocol}, preserved: ${body.summary.totalPreservedRecords}`);
  });

  await test("Admin: Response contains all required top-level + nested fields", async () => {
    if (!ADMIN_TOKEN) {
      console.log("   ⚠️  ADMIN_TOKEN not set — skipping shape check");
      return;
    }
    const { body } = await req<Record<string, unknown>>("/api/health/learning", {
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    });
    for (const key of ["success", "timestamp", "antiCascadeProtocol", "learningData", "longTermMemory", "summary"]) {
      assert(key in body, `Missing top-level field: ${key}`);
    }
```