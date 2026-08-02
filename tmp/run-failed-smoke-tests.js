const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || "";

const results = [];

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function test(name, fn) {
  const start = Date.now();
  console.log(`\n🧪 ${name}`);
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`   ✅ PASSED (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, duration, message });
    console.error(`   ❌ FAILED (${duration}ms): ${message}`);
    throw err;
  }
}

function parseCookie(setCookie) {
  if (!setCookie) return null;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const m = raw.match(/sessionId=[^;]+/i);
  return m ? m[0] : null;
}

async function req(path, opts = {}) {
  const headers = { Accept: opts.accept || "application/json", ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || 90000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timer);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, setCookie: res.headers.get("set-cookie"), text };
}

async function reqSSE(path, opts = {}) {
  const headers = { Accept: "text/event-stream", ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || 90000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timer);
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function createVerifiedSession(tag) {
  const sessId = tag ? `session_smoke_${tag}_${Date.now()}` : undefined;
  const headers = sessId ? { "X-Session-ID": sessId } : {};
  const { body, setCookie } = await req("/api/session", { method: "POST", headers });
  assert(body?.success === true && typeof body?.id === "string", `create session failed: ${JSON.stringify(body)}`);
  const cookie = parseCookie(setCookie) || (sessId ? `sessionId=${sessId}` : null);
  assert(cookie, "session cookie missing");
  const { body: verifyBody } = await req("/api/session/verify-age", { method: "POST", cookie, headers, body: { isOver18: true } });
  assert(verifyBody?.success === true, `age verify failed: ${JSON.stringify(verifyBody)}`);
  return { id: body.id, cookie };
}

async function testSynthesisStats() {
  await test("Synthesis: GET /api/synthesis/stats returns structured stats", async () => {
    const { ok, body } = await req("/api/synthesis/stats");
    assert(ok, `synthesis/stats failed: ${JSON.stringify(body)}`);
    assert(body?.success === true, "success !== true");
    assert(typeof body?.stats === "object" && body.stats !== null, "stats is not an object");
    const records = body.stats.records;
    assert(typeof records === "number", "stats.records missing or not a number");
    assert(records >= 25, `expected at least 25 seed records, got ${records}`);
  });
}

async function testScopedSynthesisIsolation() {
  await test("Isolation: Scoped synthesis retrieval differs across owner scopes", async () => {
    const [a, b] = await Promise.all([
      createVerifiedSession("isolation_synth_a"),
      createVerifiedSession("isolation_synth_b"),
    ]);

    const uniqueQuery = `Tell me about the obsidian lighthouse code ${Date.now()} in one sentence.`;
    const learned = await req("/api/chat", {
      method: "POST",
      headers: { "X-Session-ID": a.id },
      cookie: a.cookie,
      body: { message: uniqueQuery, mode: "standard", maxTokens: 250 },
      timeoutMs: 60000,
    });
    assert(learned.ok, `session A learning request failed: ${learned.status} ${JSON.stringify(learned.body)}`);

    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };
    const debugA = await req("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: { userMessage: uniqueQuery, mode: "standard", ownerScope: a.id, k: 6 },
      timeoutMs: 30000,
    });
    const debugB = await req("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: { userMessage: uniqueQuery, mode: "standard", ownerScope: b.id, k: 6 },
      timeoutMs: 30000,
    });
    assert(debugA.ok, `debugA failed: ${debugA.status} ${JSON.stringify(debugA.body)}`);
    assert(debugB.ok, `debugB failed: ${debugB.status} ${JSON.stringify(debugB.body)}`);

    const matchesA = debugA.body?.debug?.matches || [];
    const matchesB = debugB.body?.debug?.matches || [];
    const hasScopedConversationA = matchesA.some((m) => m.source === "conversation");
    const hasScopedConversationB = matchesB.some((m) => m.source === "conversation");
    assert(hasScopedConversationA, "expected session A scoped retrieval to include conversation memory");
    assert(!hasScopedConversationB, "expected session B scoped retrieval to exclude session A conversation memory");
  });
}

async function testLocalSynthesisReinforcement() {
  await test("Local Synthesis [/api/chat]: exact retrieved records get reinforced", async () => {
    const sess = await createVerifiedSession("bone_marrow_chat");
    const query = "Explain how your local synthesis system balances core knowledge and creativity.";

    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };
    const beforeDebug = await req("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: { userMessage: query, mode: "standard", k: 6 },
      timeoutMs: 30000,
    });
    assert(beforeDebug.ok, `before debug retrieval failed: ${beforeDebug.status} ${JSON.stringify(beforeDebug.body).slice(0, 300)}`);
    const beforeMatches = beforeDebug.body?.debug?.matches || [];
    assert(Array.isArray(beforeMatches) && beforeMatches.length > 0, "before debug retrieval returned no matches");
    const target = beforeMatches[0];
    const beforeBone = Number(target?.heuristicProfile?.bone ?? 0);
    const beforeMarrow = Number(target?.heuristicProfile?.marrow ?? 0);

    const first = await req("/api/chat", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: { message: query, mode: "standard", maxTokens: 600 },
      timeoutMs: 60000,
    });
    assert(first.ok, `initial local synthesis request failed: ${first.status} ${JSON.stringify(first.body).slice(0, 300)}`);

    const feedback = await req("/api/chat", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: { message: "that was great and smart and creative", mode: "standard", maxTokens: 300 },
      timeoutMs: 60000,
    });
    assert(feedback.ok, `feedback request failed: ${feedback.status} ${JSON.stringify(feedback.body).slice(0, 300)}`);

    const afterDebug = await req("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: adminHeaders,
      body: { userMessage: query, mode: "standard", k: 6 },
      timeoutMs: 30000,
    });
    assert(afterDebug.ok, `after debug retrieval failed: ${afterDebug.status} ${JSON.stringify(afterDebug.body).slice(0, 300)}`);
    const afterMatches = afterDebug.body?.debug?.matches || [];
    const sameRecord = afterMatches.find((m) => m.id === target.id);
    assert(sameRecord, `target record ${target.id} missing after feedback`);
    const afterBone = Number(sameRecord?.heuristicProfile?.bone ?? 0);
    const afterMarrow = Number(sameRecord?.heuristicProfile?.marrow ?? 0);
    const afterSpine = Number(sameRecord?.heuristicProfile?.spine ?? 0);
    console.log(`   exact record heuristicProfile: bone ${beforeBone} -> ${afterBone}, marrow ${beforeMarrow} -> ${afterMarrow}, spine=${afterSpine}`);

    assert(afterBone >= beforeBone, "expected reinforced record bone score to stay same or increase");
    assert(afterMarrow >= beforeMarrow, "expected reinforced record marrow score to stay same or increase");
    assert(Number.isFinite(afterSpine), "after spine score is not finite");
  });
}

async function testLocalSynthesisStreamFallback() {
  await test("Local Synthesis [/api/chat/stream]: mirrored feedback loop survives SSE fallback path", async () => {
    const sess = await createVerifiedSession("bone_marrow_stream");

    const stream1 = await reqSSE("/api/chat/stream", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: { message: "Explain your seed-first local synthesis logic in a concise way.", mode: "standard", maxTokens: 500 },
      timeoutMs: 60000,
    });
    assert(stream1.ok, `initial stream request failed: ${stream1.status} ${stream1.text.slice(0, 300)}`);
    console.log(`   stream response preview: ${stream1.text.slice(0, 220).replace(/\n/g, " ")}`);

    const streamFeedback = await reqSSE("/api/chat/stream", {
      method: "POST",
      headers: { "X-Session-ID": sess.id },
      cookie: sess.cookie,
      body: { message: "not relevant and too bland", mode: "standard", maxTokens: 300 },
      timeoutMs: 60000,
    });
    assert(streamFeedback.ok, `stream feedback request failed: ${streamFeedback.status} ${streamFeedback.text.slice(0, 300)}`);

    const debug = await req("/api/synthesis/test-retrieval", {
      method: "POST",
      headers: { "x-admin-token": ADMIN_TOKEN },
      body: { userMessage: "Explain your seed-first local synthesis logic in a concise way.", mode: "standard", k: 6 },
      timeoutMs: 30000,
    });
    assert(debug.ok, `stream debug retrieval failed: ${debug.status} ${JSON.stringify(debug.body).slice(0, 300)}`);
    const matches = debug.body?.debug?.matches || [];
    assert(Array.isArray(matches) && matches.length > 0, "heuristic matches missing after stream feedback");
    console.log(`   mirrored first match heuristicProfile: ${JSON.stringify(matches[0]?.heuristicProfile ?? null)}`);
  });
}

async function testAdminLearningHealth() {
  await test("Admin: Valid token → 200 with structured count schema", async () => {
    const { ok, body } = await req("/api/health/learning", {
      headers: { "X-Admin-Token": ADMIN_TOKEN },
    });
    assert(ok, `valid token rejected: ${JSON.stringify(body)}`);
    assert(body?.success === true, "success !== true");
    assert(body?.antiCascadeProtocol === "active", `antiCascadeProtocol must be 'active', got: ${body?.antiCascadeProtocol}`);
    const ld = body.learningData;
    const ltm = body.longTermMemory;
    assert(typeof ld?.total === "number" && ld.total >= 0, `learningData.total invalid`);
    assert(ld.total === ld.detachedFromDeletedSessions + ld.linkedToActiveSessions, "learningData counts don't add up");
    assert(ltm.total === ltm.detachedFromDeletedSessions + ltm.linkedToActiveSessions, "longTermMemory counts don't add up");
    assert(body.summary?.totalPreservedRecords === ld.total + ltm.total, "summary total mismatch");
  });
}

async function run() {
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "set" : "NOT set"}`);

  await testSynthesisStats();
  if (!ADMIN_TOKEN) {
    console.log("\nADMIN_TOKEN is not set; stopping after synthesis/stats.");
    process.exit(0);
  }

  await testScopedSynthesisIsolation();
  await testLocalSynthesisReinforcement();
  await testLocalSynthesisStreamFallback();
  await testAdminLearningHealth();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  console.log(`\n=== SUMMARY: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) {
    results.filter((r) => !r.passed).forEach((r) => {
      console.error(`\nFAILED: ${r.name}\n   ${r.message}`);
    });
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
