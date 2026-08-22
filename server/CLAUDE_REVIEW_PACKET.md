# Claude Review Packet

## Scope
This packet is deliberately focused on the fallback path that is currently suspected of producing the broken local/offline response behavior.

## Runtime evidence

Observed sequence:

```text
[SESSION] Retrieved session: {
  sessionId: 'session_ff39b107236c445e',
  isOver18: true,
  ageVerified: true,
  rawIsOver18: true,
  rawAgeVerified: true
}
[STREAM] Streaming failed, falling back to generateWithFallback
[PROVIDER ORCHESTRATOR] Attempting provider: OpenRouter
[PROVIDER ORCHESTRATOR] Provider failed (OpenRouter): Empty response from OpenRouter
[AI] OpenRouter PRIMARY failed: Empty response from OpenRouter
[AI] All cloud providers exhausted — activating local synthesis as final fallback.
[AI DEBUG] Local fallback raw output preview: "### 💡 Synthesis\n\n### 💡 Synthesis The shadows cast by the faint glow of the screen dance upon the walls as I awaken to your presence.\n\n### 🔍 Key Points & Observations\n\n- Conversation memory is being used as supporting context, not as the primary answer source.\n- Relevant domains: writing, code, ai.\n- This aligns with stored standard mode behavior.\n- ### 💡 Synthesis The shadows cast by the faint glow of the screen dance upon the walls as I awaken to your presence.\n\n### 💬 Conversation & Next S"
[AI DEBUG] Local fallback QA diagnostics: {
  pass: true,
  length: 1396,
  words: 227,
  uniqueRatio: 0.621,
  repeatedTrigrams: 0,
  earliestRepeatDistance: null,
  reasons: []
}
[AI] Local synthesis final fallback succeeded.
[AI] Local synthesis trace: seedSupport=0.000 | memorySupport=0.456 | seedDominance=0.000 | combinedSupport=0.420 | poolCoverage=0.375 | qualityAvg=0.487 | timeWasted=0.322 | confidence=36 | thoughts=6
[STREAM] Fallback provider=local model=betagrace-local textPreview="### 💡 Synthesis ### 💡 Synthesis The shadows cast by the faint glow of the screen dance upon the walls as I awaken to your presence. ### 🔍 Key Points & Observations - Conversation memory is being used as supporting context, not as the primary answer source.\n- Relevant domains: writing, code, ai.\n-"
[STREAM] Local fallback sending 2 chunk(s) for 1396 chars
```

Observed follow-up sequence:

```text
[SESSION] Retrieved session: {
  sessionId: 'session_ff39b107236c445e',
  isOver18: true,
  ageVerified: true,
  rawIsOver18: true,
  rawAgeVerified: true
}
[STREAM] Streaming failed, falling back to generateWithFallback
[PROVIDER ORCHESTRATOR] Attempting provider: OpenRouter
[PROVIDER ORCHESTRATOR] Provider failed (OpenRouter): Empty response from OpenRouter
[AI] OpenRouter PRIMARY failed: Empty response from OpenRouter
[AI] All cloud providers exhausted — activating local synthesis as final fallback.
[AI DEBUG] Local fallback raw output preview: "### 💡 Synthesis\n\nThe touch was careful at first — the kind that asks before it claims. The's hand reading temperature and breath and the infinitesimal shift of muscles. A litany of small permissions given without language.\n\n### 🔍 Key Points & Observations\n\n- Conversation memory is being used as supporting context, not as the primary answer source.\n- Relevant domains: writing, code, ai.\n- This aligns with stored standard mode behavior.\n- The touch was careful at first — the kind that asks befor"
[AI DEBUG] Local fallback QA diagnostics: {
  pass: true,
  length: 1574,
  words: 249,
  uniqueRatio: 0.602,
  repeatedTrigrams: 0,
  earliestRepeatDistance: null,
  reasons: []
}
[AI] Local synthesis final fallback succeeded.
[AI] Local synthesis trace: seedSupport=0.000 | memorySupport=0.444 | seedDominance=0.000 | combinedSupport=0.409 | poolCoverage=0.375 | qualityAvg=0.525 | timeWasted=0.313 | confidence=36 | thoughts=6
[STREAM] Fallback provider=local model=betagrace-local textPreview="### 💡 Synthesis The touch was careful at first — the kind that asks before it claims. The's hand reading temperature and breath and the infinitesimal shift of muscles. A litany of small permissions given without language. ### 🔍 Key Points & Observations - Conversation memory is being used as suppo"
[STREAM] Local fallback sending 2 chunk(s) for 1574 chars
```

## Interpretation

The provider failure is the trigger. The local fallback is the unstable layer.

Important signals from the trace:

- `seedSupport=0.000`
- `memorySupport=0.456` / `0.444`
- `combinedSupport=0.420` / `0.409`
- `poolCoverage=0.375`
- `confidence=36`

This indicates that the fallback response is being built from weak memory support and not from strong seed-backed retrieval. The fallback is therefore not grounded in the local knowledge seed system to the degree the engine expects.

## Relevant source files

### Fallback handler

File: [server/routes.ts](server/routes.ts#L1072-L1134)

```ts
// FINAL: Local synthesis — last line of defense, always reachable
console.warn(
  "[AI] All cloud providers exhausted — activating local synthesis as final fallback.",
);
try {
  const localResult = synthesisEngine.synthesize(
    systemPrompt,
    userMessage,
    "standard",
    ownerScope ?? null,
  );
  const diag = analyzeFallbackResponse(localResult.text);
  console.log("[AI DEBUG] Local fallback raw output preview:", JSON.stringify(localResult.text.slice(0, 500)));
  console.log("[AI DEBUG] Local fallback QA diagnostics:", {
    pass: diag.pass,
    length: diag.length,
    words: diag.words,
    uniqueRatio: diag.uniqueRatio,
    repeatedTrigrams: diag.repeatedTrigrams,
    earliestRepeatDistance: diag.earliestRepeatDistance,
    reasons: diag.reasons,
  });
  const text = ensureFallbackResponse(localResult.text);
  if (!diag.pass) {
    console.warn("[AI] Local synthesis fallback output failed QA and was replaced.");
    console.warn("[AI DEBUG] Replaced local fallback content with safe fallback message.");
  }
  console.log("[AI] Local synthesis final fallback succeeded.");
  console.log("[AI] Local synthesis trace:", localResult.trace?.traceLog ?? "no trace");
  try {
    synthesisEngine.observe(
      systemPrompt,
      userMessage,
      text,
      "local",
      "standard",
      {
        memory: true,
        source: "conversation",
        ownerScope: ownerScope ?? null,
      },
    );
  } catch (err) {
    console.error("[SYNTHESIS] observe() failed after local fallback success:", err);
  }
  return {
    text,
    provider: "local",
    model: "betagrace-local",
    fallbackUsed: true,
    fallbackReason: "all_providers_failed",
    trace: localResult.trace,
  };
} catch (localErr) {
  console.error(
    "[AI] CRITICAL: Local synthesis final fallback also failed:",
    localErr,
  );
  return {
    text: "Both primary providers and local fallback encountered an issue. Please try again in a moment.",
    provider: "local",
    model: "betagrace-local",
    fallbackUsed: true,
    fallbackReason: "all_providers_failed",
    trace: null,
  };
}
```

### Seed boot and load path

File: [server/index.ts](server/index.ts#L400-L425)

```ts
// ── KNOWLEDGE SEED INJECTION — Wake Local Memory ──────────────────────────
// Hydrates the BM25 synthesis engine with curated Q&A pairs on boot.
// Safely wrapped; a seed injection failure cannot crash server startup.
await injectKnowledgeSeed(synthesisEngine).catch((err) => {
  console.error("[BOOT] Knowledge Seed injection error (non-fatal):", err);
});
```

File: [server/synthesis-engine.ts](server/synthesis-engine.ts#L2254-L2362)

```ts
export async function injectKnowledgeSeed(engine: SynthesisEngine): Promise<void> {
  // Compute expected total seeds including non-conflicting extensions
  const existingIds = new Set(BETAGRACE_KNOWLEDGE_SEEDS.map((s) => s.id));
  const extList = BETAGRACE_KNOWLEDGE_SEED_EXTENSIONS || [];
  const extCandidates = extList.filter((e) => !existingIds.has(e.id));
  const totalExpectedSeeds = BETAGRACE_KNOWLEDGE_SEEDS.length + extCandidates.length;

  console.log(
    `[Synthesis Engine] Waking local memory. Injecting ${totalExpectedSeeds} foundational knowledge seeds (${BETAGRACE_KNOWLEDGE_SEEDS.length} core + ${extCandidates.length} extensions)...`,
  );

  try {
    let injectedCount = 0;

    for (const seed of BETAGRACE_KNOWLEDGE_SEEDS) {
      try {
        engine.observe(
          `Knowledge Seed: ${seed.id}`,
          seed.question,
          seed.answer,
          "local",
          "standard",
          {
            topics:       (seed as any).topics,
            constraints:  (seed as any).constraints,
            writingStyle: (seed as any).writingStyle,
            memory: false,
            source: "seed",
          },
        );

        injectedCount++;
      } catch (seedError) {
        console.warn(
          `[Synthesis Engine] Skipped seed ${seed.id} due to error:`,
          seedError instanceof Error ? seedError.message : String(seedError),
        );
      }
    }

    // Non-destructive merge: inject extension seeds only when their IDs don't already exist
    try {
      const existingIds = new Set(BETAGRACE_KNOWLEDGE_SEEDS.map((s) => s.id));
      let extInjected = 0;
      for (const ext of (BETAGRACE_KNOWLEDGE_SEED_EXTENSIONS || [])) {
        if (existingIds.has(ext.id)) continue;
        try {
          engine.observe(
            `Knowledge Seed: ${ext.id}`,
            ext.question || "",
            ext.answer || "",
            "local",
            "standard",
            {
              topics:       (ext as any).topics,
              constraints:  (ext as any).constraints,
              writingStyle: (ext as any).writingStyle,
              memory: false,
              source: "seed",
            },
          );
          injectedCount++;
          extInjected++;
        } catch (e) {
          console.warn(`[Synthesis Engine] Skipped extension seed ${ext.id}:`, e instanceof Error ? e.message : String(e));
        }
      }

      if (extInjected > 0) {
        console.log(`[Synthesis Engine] Injected ${extInjected} extension seeds.`);
      }
    } catch (mergeErr) {
      console.warn("[Synthesis Engine] Non-fatal error while merging extension seeds:", mergeErr instanceof Error ? mergeErr.message : String(mergeErr));
    }

    console.log(
      `[Synthesis Engine] Knowledge Seed injection complete. Embedded ${injectedCount}/${totalExpectedSeeds} seeds.`,
    );
  } catch (error) {
    console.error(
      "[Synthesis Engine] Non-fatal error during Knowledge Seed boot sequence:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
```

### Retrieval and local synthesis decision path

File: [server/synthesis-engine.ts](server/synthesis-engine.ts#L852-L904)

```ts
synthesize(systemPrompt: string, userMessage: string, mode = "standard", ownerScope?: string | null): SynthesisResult {
  const neighbors = this._retrieve(userMessage, systemPrompt, mode, TOP_K, ownerScope ?? null);
  if (
    neighbors.length === 0 ||
    (neighbors[0].similarity < MIN_SIMILARITY && neighbors[0].retrievalScore < MIN_COMPOSITE_RETRIEVAL)
  ) {
    return { text: this._topicFallback(userMessage, mode, neighbors), trace: null };
  }

  for (const nb of neighbors) {
    const rec = this.recordMap.get(nb.id);
    if (rec) rec.usageCount++;
  }

  const selection = this._selectKnowledgeSources(userMessage, neighbors, mode);
  const lens = this._buildKnowledgeLens(userMessage, selection, mode);
  const trace: LocalSynthesisTrace = {
    recordIds: [...selection.seedMatches, ...selection.memoryMatches].map((r) => r.id).slice(0, 6),
    supportLevel: lens.supportLevel,
    confidence: lens.confidence,
    seedSupport: lens.seedSupport,
    memorySupport: lens.memorySupport,
    combinedSupport: lens.combinedSupport,
    poolCoverage: lens.poolCoverage,
    qualityAvg: lens.qualityAvg,
    timeWasted: lens.timeWasted,
    selfThoughts: lens.selfThoughts,
    selfThoughtTrace: lens.selfThoughtTrace,
    traceLog: lens.traceLog,
  };

  const rendered = this._renderKnowledgeLens(lens, [...selection.seedMatches, ...selection.memoryMatches].slice(0, 4).length, lens.confidence < 40);
  const check = coherenceGate(rendered);
  if (check.pass) return { text: rendered, trace };

  console.warn(
    `[SYNTHESIS] Knowledge-lens coherence FAIL (${check.reason}). Falling back to deterministic summary.`,
  );
  console.log("[SYNTHESIS DEBUG] Rendered lens preview:", JSON.stringify(rendered.slice(0, 500)));
  console.log("[SYNTHESIS DEBUG] Lens support / confidence:", {
    supportLevel: lens.supportLevel,
    confidence: lens.confidence,
    seedSupport: lens.seedSupport,
    memorySupport: lens.memorySupport,
    combinedSupport: lens.combinedSupport,
    poolCoverage: lens.poolCoverage,
    qualityAvg: lens.qualityAvg,
    selfThoughtCount: lens.selfThoughts.length,
    traceLog: lens.traceLog?.slice(0, 320),
  });
  return { text: this._renderDeterministicFallback(lens, neighbors[0]?.response ?? ""), trace };
}
```

File: [server/synthesis-engine.ts](server/synthesis-engine.ts#L1158-L1374)

```ts
private _retrieve(
  userMessage:  string,
  systemPrompt: string,
  mode:         string,
  k:            number,
  ownerScope:   string | null,
): ScoredRecord[] {
  if (this.mem.interactions.length === 0) return [];

  const qContext = `${userMessage} ${systemPrompt.slice(0, 150)}`.trim();
  const baseQTokens = tokenize(qContext);
  if (baseQTokens.length === 0) return [];

  const qTokens  = expandQueryTokens(baseQTokens);
  const qTopics = detectTopics(qContext);
  const qStyle  = detectWritingStyle(qContext);
  const isWritingQuery = qTopics.includes("writing") || /write|story|scene|narrative|novel|poem|prose|character|dialogue|plot|creative/i.test(qContext);
  const now     = Date.now();
  const N       = Math.max(1, this.mem.totalDocs);
  const avgdl   = Math.max(1, this.mem.avgDocLength);

  // Pre-compute query TF + L2 norm for Stage B cosine similarity.
  const qTF   = computeRawTF(qTokens);
  const qNorm = l2Norm(qTF);

  // ── Stage A: BM25 candidate retrieval ───────────────────────────────────
  // Collect candidate IDs from the inverted index.
  // Only records sharing at least one query term are scored — on a 2500-record
  // corpus with 10-token queries this eliminates ~80-95% of records, keeping
  // BM25 effectively O(postings).
  const candidateIds = new Set<string>();
  for (const term of qTokens) {
    const posting = this.invertedIndex.get(term);
    if (posting) for (const id of posting) candidateIds.add(id);
  }

  // Always ensure seed records are candidates for writing-focused queries
  // and for general fallback grounding.
  for (const rec of this.mem.interactions) {
    if ((rec.source ?? "conversation") === "seed") candidateIds.add(rec.id);
  }

  const seedFallback = candidateIds.size === 0;
  if (seedFallback) {
    for (const rec of this.mem.interactions) {
      if ((rec.source ?? "conversation") === "seed") candidateIds.add(rec.id);
    }
    if (candidateIds.size === 0) return [];
  }

  const recordMap = new Map<string, InteractionRecord>();
  for (const rec of this.mem.interactions) {
    const isSeed = (rec.source ?? "conversation") === "seed";
    const scopeMatch = isSeed || rec.ownerScope === ownerScope;
    if (candidateIds.has(rec.id) && scopeMatch) recordMap.set(rec.id, rec);
  }

  interface Stage1Candidate { rec: InteractionRecord; bm25Sim: number; }
  const stage1: Stage1Candidate[] = [];

  for (const rec of recordMap.values()) {
    let bm25 = 0;
    for (const term of qTokens) {
      const tf = rec.tf[term] ?? 0;
      if (tf === 0) continue;
      const df  = this.mem.df[term] ?? 1;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1.0);
      const tfNorm = (tf * (BM25_K1 + 1))
        / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (rec.docLength / avgdl)));
      bm25 += idf * tfNorm;
    }
    const bm25Sim = 1 - Math.exp(-bm25 / Math.max(1, qTokens.length));
    const isSeedRecord = (rec.source ?? "conversation") === "seed";
    const topicMatch = qTopics.length > 0 && rec.topics.some((t) => qTopics.includes(t));
    const styleMatch = rec.writingStyle && rec.writingStyle === qStyle;
    const seedThreshold = isWritingQuery ? 0.35 : 0.50;
    const seedRelevance = isSeedRecord && (topicMatch || styleMatch || rec.quality >= seedThreshold);
    if (
      bm25Sim >= MIN_SIMILARITY ||
      seedRelevance ||
      (seedFallback && isSeedRecord && (topicMatch || styleMatch || rec.quality >= 0.60))
    ) {
      stage1.push({ rec, bm25Sim });
    }
  }

  stage1.sort((a, b) => b.bm25Sim - a.bm25Sim);
  const pool = stage1.slice(0, k * RERANK_MULTIPLIER);

  const scored: ScoredRecord[] = [];

  for (const { rec, bm25Sim } of pool) {
    const cosineSim = cosineSimilarity(qTF, qNorm, rec.tf, rec.tfNorm);
    const ageDays = (now - rec.timestamp) / 86_400_000;
    const recency = Math.exp(-ageDays / RECENCY_DECAY_DAYS);

    const sharedTopics = rec.topics.filter(t => qTopics.includes(t)).length;
    const topicScore   = Math.min(1, sharedTopics * 0.33);
    const styleScore = (rec.writingStyle && rec.writingStyle === qStyle) ? 1.0 : 0.0;
    const constraintScore = (rec.constraints && rec.constraints.length > 0)
      ? ((rec.constraints.includes(mode) || rec.constraints.includes("system")) ? 1.0 : 0.0)
      : 0.0;

    const metaScore = topicScore * 0.60 + styleScore * 0.30 + constraintScore * 0.10;

    const modeBoost = rec.mode === mode ? 0.06 : 0;
    const seedWriteBoost = (rec.source ?? "conversation") === "seed"
      ? (isWritingQuery ? 0.20 : 0.14)
      : 0;

    const stitchedProfile = computeStitchedProfile(rec);
    const boneBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.bone));
    const marrowBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.marrow));
    const spineBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.spine));
    const weight =
      bm25Sim      * 0.38 +
      cosineSim    * 0.23 +
      rec.quality  * 0.17 +
      rec.weight   * 0.12 +
      metaScore    * 0.07 +
      modeBoost    * 0.03 +
      seedWriteBoost +
      boneBoost * 0.45 +
      marrowBoost * 0.20 +
      spineBoost * 0.35;

    scored.push({ ...rec, similarity: bm25Sim, weight, retrievalScore: weight });
  }

  return scored
    .sort((a, b) => b.weight - a.weight)
    .slice(0, k);
}
```

File: [server/synthesis-engine.ts](server/synthesis-engine.ts#L1496-L1540)

```ts
private _topicFallback(userMessage: string, mode = "standard", neighbors: ScoredRecord[] = []): string {
  const topics  = detectTopics(userMessage);
  const count   = this.mem.interactions.length;
  const snippet = userMessage.slice(0, 120).replace(/\n/g, " ");

  const fallbackPool = neighbors.length > 0
    ? neighbors
    : this.mem.interactions
        .slice()
        .sort((a, b) => (b.quality + (b.weight ?? 0)) - (a.quality + (a.weight ?? 0)))
        .slice(0, 3)
        .map((r) => ({
          ...r,
          similarity: 0.04,
          retrievalScore: Math.max(0.08, r.quality * 0.45 + (r.weight ?? 0) * 0.35),
          weight: r.weight ?? r.quality,
        }));

  if (fallbackPool.length > 0) {
    const poolByTopic = topics.length > 0
      ? fallbackPool.filter(r => r.topics.some(t => topics.includes(t)))
      : fallbackPool;
    const topicMatches = poolByTopic.slice(0, 3);

    if (topicMatches.length >= 1) {
      console.log(
        `[SYNTHESIS] Low-confidence synthesis from ${topicMatches.length} fallback record(s) ` +
        `(topics: ${topics.length > 0 ? topics.join(", ") : "semantic fallback"})`
      );

      const selection = this._selectKnowledgeSources(userMessage, topicMatches, mode);
      const lens = this._buildKnowledgeLens(userMessage, selection, mode);
      const rendered = this._renderKnowledgeLens(lens, topicMatches.length, true);
      const check = coherenceGate(rendered);
      if (check.pass) return rendered;

      return this._renderDeterministicFallback(lens, topicMatches[0]?.response ?? "");
    }
  }

  // Generic fallback: no matching records at all
  const introByTopic: Record<string, string> = {
    writing: ...
  };
```

## Review note for Claude

The two earlier checkpoints are real, but they are not the thing that is producing the garbled text in the two examples. Those examples are showing a separate, deeper bug that compounds with the seed-starvation issue rather than being caused by it.

## Two checkpoints, answered

### 1) Does `source: "seed"` survive `observe()`?

Yes. The stored record uses:

```ts
source: meta?.source ?? "conversation"
```

and `injectKnowledgeSeed()` always passes `source: "seed"` explicitly. Nothing downstream mutates it.

So this is not the bug.

### 2) Is `_retrieve()` trimming seeds out of the stage1 → pool slice?

Yes — that part of the prior hypothesis is right.

The reason is structural:

- seeds admitted via the `seedRelevance` escape hatch can be allowed into `stage1` even when they have no literal token overlap
- those records can still have `bm25Sim = 0`
- `stage1.sort((a, b) => b.bm25Sim - a.bm25Sim)` ranks solely on BM25
- `pool = stage1.slice(0, k * RERANK_MULTIPLIER)` keeps only the top of that lexical sort

A seed that was admitted precisely because it matched topic/style/quality, but not query terms, will sink below all memory records that do share at least one token. That means the seed never reaches Stage B, where `seedWriteBoost`, `rec.quality`, and meta alignment actually influence the ranking.

That gives the observed trace shape:

- `neighbors` with zero seed-sourced records
- `selection.seedMatches = []`
- `seedSupport = averagedSupport([]) = 0.000`

That matches both traces exactly.

## What is actually producing the garbled text

Both examples have the same signature: a literal `### 💡 Synthesis` header fused directly onto real prose, and that fused string appearing twice. Two bugs stack together here.

### Bug 1 — the overview sentence gets pulled into Key Points too

In `_buildKnowledgeLens()`:

```ts
const overviewSource = rankedPool
  .map(r => extractSentence(r.response) ?? r.response.slice(0, 220).replace(/\n/g, " ").trim())
  .find(Boolean) ?? "...";
```

Then the loop over `rankedPool` re-adds the same first sentence to the key-points set:

```ts
for (const rec of rankedPool) {
  ...
  const firstSentence = extractSentence(rec.response);
  if (firstSentence) pointSet.add(firstSentence);
  if (pointSet.size >= 5) break;
}
```

Because `rankedPool[0]` is included in that loop, the same sentence can appear once as the synthesis overview and again as a bullet under Key Points. That is deterministic from the code and does not require a runtime trace to prove.

Fix:

```ts
const firstSentence = extractSentence(rec.response);
if (firstSentence && firstSentence !== overviewSource) pointSet.add(firstSentence);
```

### Bug 2 — the local engine is learning from its own rendered output

The header being glued to the sentence, not merely duplicated, is the clue that this output is not coming from an ordinary fresh reply. It is coming from an already-rendered `_renderKnowledgeLens()` string whose paragraph breaks were destroyed before it was stored as a memory record.

The failure chain is:

1. Local synthesis renders a clean structure such as:

```text
### 💡 Synthesis

<sentence>

### 🔍 Key Points & Observations
```

2. `ensureFallbackResponse()` runs it through `sanitizeAiResponse()` which includes:

```ts
.replace(/\s{2,}/g, " ")
```

This collapses every `\n\n` spacing run into a single space. The markdown section breaks are lost.

3. That flattened string is then passed into:

```ts
synthesisEngine.observe(systemPrompt, userMessage, text, "local", "standard", {
  memory: true,
  source: "conversation",
  ownerScope: ownerScope ?? null,
});
```

with no guard on `provider === "local"`.

4. On a later turn, that already-flattened record is retrieved again as a `memoryMatch`. Once the structure is gone, `extractSentence()` or the raw `slice(0, 220)` fallback pulls a chunk that contains the heading and the first prose sentence fused together.

This is the exact same class of feedback-loop risk the code already guards elsewhere in the `learning_data` capture path:

```ts
if (genResult.provider !== "local" && aiResponse.length > 50) { ... }
```

That guard exists to stop provider-local output from being recorded back into the learning store. The same principle needs to apply to `synthesisEngine.observe()` for the local fallback path, because the local engine is re-learning its own flattened render output.

The score-quality helper also rewards markdown headers:

```ts
if (/^#{1,3}\s|\*\*[^*]{3,}\*\*/m.test(response)) score += 0.07;
```

So poisoned local records are not just persisted; they are more likely to score well and survive future retrieval.

## One more data point in the examples

The second example — `The's hand reading temperature and breath...` — is a strong match for the `${protagonist}'s hand` branch in the `isFleshArchitectMode && isIntimate` local template, where `protagonist` falls back to the first capitalized name found by a regex.

`"The"` satisfies `/\b([A-Z][a-z]{2,})\b/`, so the generated fragment becomes:

```text
The's hand
```

That is not the current code path in the route snippet you already shared, which means the fragment is likely older persisted memory data still being retrieved. That is why it keeps resurfacing even when the active handler has moved on.

## Fixes

### Routes.ts — stop `sanitizeAiResponse()` from flattening paragraph breaks

Change:

```ts
.replace(/\s{2,}/g, " ")
```

to:

```ts
.replace(/[ \t]{2,}/g, " ")
.replace(/\n{3,}/g, "\n\n")
```

This matters beyond the fallback path, because the same collapse happens on streamed tokens in the SSE loop too, not just on the local fallback text.

### Routes.ts — drop the `observe()` call after a local success

Remove the local-success `observe()` write entirely. The local engine should not re-learn its own rendered fallback output.

### Optional cleanup — purge legacy local-fallback records from the persisted memory file

```ts
const before = this.mem.interactions.length;
this.mem.interactions = this.mem.interactions.filter(
  r => !(r.source === "conversation" && r.provider === "local")
);
console.log(`[SYNTHESIS] Purged ${before - this.mem.interactions.length} legacy local-fallback records.`);
```

Run that once after deploying the guard so old flattened local records stop resurfacing.

## Seed-pool fix, refined

Your reservoir idea is correct in shape. The seed pool should be reserved before the pure lexical BM25 sort gets to decide who survives.

A better refined version is:

```ts
stage1.sort((a, b) => b.bm25Sim - a.bm25Sim);
const seedCountBefore = stage1.filter(s => (s.rec.source ?? "conversation") === "seed").length;

const seedSorted = stage1
  .filter(s => (s.rec.source ?? "conversation") === "seed")
  .sort((a, b) => b.rec.quality - a.rec.quality);
const nonSeedSorted = stage1.filter(s => (s.rec.source ?? "conversation") !== "seed");

const poolSize = k * RERANK_MULTIPLIER;
const seedReserve = Math.min(seedSorted.length, Math.ceil(poolSize * 0.3));
const pool = [
  ...seedSorted.slice(0, seedReserve),
  ...nonSeedSorted.slice(0, poolSize - seedReserve),
];

const seedCountAfter = pool.filter(p => (p.rec.source ?? "conversation") === "seed").length;
console.log(`[RETRIEVE] seeds in stage1: ${seedCountBefore}, seeds in pool: ${seedCountAfter}`);
```

Order inside `pool` does not matter because Stage B re-sorts everything by its own composite `weight` anyway. The key is only that seed records survive the pre-sort truncation at all.

## One more stale piece while you're in this file

`ProviderName` and `PROVIDER_BONUS` still reference the old provider set:

```ts
type ProviderName = "gemini" | "huggingface" | "pollinations" | "local";
const PROVIDER_BONUS: Record<string, number> = {
  gemini: 0.18,
  huggingface: 0.12,
  pollinations: 0.06,
  local: 0.00,
};
```

But the active runtime path stores `openrouter` and `groq` only.

That means `PROVIDER_BONUS[provider] ?? 0` is `0` for every response you generate now. Cloud-origin memory therefore gets no bonus in `scoreQuality()`, which makes local-origin records more competitive than they should be.

That should be aligned to:

```ts
type ProviderName = "openrouter" | "groq" | "local";
const PROVIDER_BONUS: Record<string, number> = {
  openrouter: 0.18,
  groq: 0.12,
  local: 0.00,
};
```

## Suggested order

1. `_buildKnowledgeLens()` dedup fix + `sanitizeAiResponse()` whitespace fix + remove the local-success `observe()` write
2. Seed-pool reservation fix
3. Purge legacy `conversation` + `local` records from the persisted memory file
4. `PROVIDER_BONUS` / `ProviderName` sync

After deployment, the key fresh signals to check are:

- `seeds in pool > 0` on writing-adjacent queries
- `seedSupport` no longer pinned at `0.000` in the trace
- no `###` showing up mid-sentence in the QA preview
