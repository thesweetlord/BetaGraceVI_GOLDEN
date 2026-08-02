const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
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
  return { status: res.status, ok: res.ok, body, text };
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

async function run() {
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "set" : "NOT set"}`);
  if (!ADMIN_TOKEN) {
    throw new Error("ADMIN_TOKEN must be set to run this isolation test.");
  }

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
  const headers = { "x-admin-token": ADMIN_TOKEN };
  const debugA = await req("/api/synthesis/test-retrieval", {
    method: "POST",
    headers,
    body: { userMessage: uniqueQuery, mode: "standard", ownerScope: a.id, k: 6 },
    timeoutMs: 30000,
  });
  const debugB = await req("/api/synthesis/test-retrieval", {
    method: "POST",
    headers,
    body: { userMessage: uniqueQuery, mode: "standard", ownerScope: b.id, k: 6 },
    timeoutMs: 30000,
  });
  console.log(`debugA status=${debugA.status}`);
  console.log(`debugB status=${debugB.status}`);
  console.log(`debugA body=${JSON.stringify(debugA.body).slice(0, 1200)}`);
  console.log(`debugB body=${JSON.stringify(debugB.body).slice(0, 1200)}`);
  assert(debugA.ok, `debugA failed: ${debugA.status} ${JSON.stringify(debugA.body)}`);
  assert(debugB.ok, `debugB failed: ${debugB.status} ${JSON.stringify(debugB.body)}`);
  const matchesA = debugA.body?.debug?.matches || [];
  const matchesB = debugB.body?.debug?.matches || [];
  const hasScopedConversationA = matchesA.some((m) => m.source === "conversation");
  const hasScopedConversationB = matchesB.some((m) => m.source === "conversation");
  console.log(`hasScopedConversationA=${hasScopedConversationA}`);
  console.log(`hasScopedConversationB=${hasScopedConversationB}`);
  assert(hasScopedConversationA, "expected session A scoped retrieval to include conversation memory");
  assert(!hasScopedConversationB, "expected session B scoped retrieval to exclude session A conversation memory");
  console.log("PASSED scoped synthesis isolation smoke test");
}

run().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
