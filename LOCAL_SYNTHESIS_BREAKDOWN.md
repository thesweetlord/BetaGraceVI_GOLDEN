# Local Synthesis Engine and `/api/chat/stream` Breakdown

## Overview

This document records the major local synthesis and streaming-chat architecture work added to BetaGrace. The goal of these changes was to make local fallback smarter, more coherent, less memory-jumbled, more seed-guided, and safer to scale without breaking the rest of the app.

---

## 1. Local synthesis moved from memory splicing to knowledge synthesis

### Before
Local fallback leaned heavily on:
- retrieved memory sentence splitting
- MMR sentence selection
- direct memory fragment reuse

This could produce:
- stitched-together responses
- memory residue
- less intentional output
- weaker distinction between core knowledge and learned context

### After
Local synthesis now behaves more like a knowledge composer:
- retrieves relevant records
- separates foundational seed knowledge from conversation memory
- builds a structured knowledge lens
- uses memory as support rather than as the answer itself

This makes fallback feel:
- cleaner
- more coherent
- more grounded in actual system knowledge
- less jumbled

---

## 2. Seed-first synthesis architecture

The engine now explicitly distinguishes:
- **seed knowledge**
- **conversation memory**

### Retrieval priority
The system now prefers:
1. foundational seed knowledge first
2. relevant supporting memory second
3. recent residue last

### Why this matters
This prevents the local engine from acting like a raw transcript-reassembly system. Instead, it answers from a core knowledge base and uses memory to personalize or support the answer.

---

## 3. Knowledge-lens response generation

A structured `KnowledgeLens` layer was added to local synthesis.

### It produces:
- `overview`
- `keyPoints`
- `nextStep`
- `confidence`
- `supportLevel`

### Result
Instead of stitching raw memory sentences together, the engine synthesizes a shaped response from structured internal signals.

---

## 4. New internal knowledge domains added as seeds

The seed system was extended with new conceptual operating layers:

- **bi-ops**
- **triage**
- **deluge**
- **local synthesis priority**

### What they mean
- **Bi-ops**: balances the immediate prompt against internal system knowledge priorities
- **Triage**: classifies the request before answering so the engine chooses the right synthesis posture
- **Deluge**: maintains broad knowledge coverage without dumping everything at once
- **Local synthesis priority**: enforces seed knowledge first, supporting memory second, residue last

These were added through the same structured seed system as the rest of the knowledge base.

---

## 5. Deluge principle hardened against blandness

The `deluge` seed was strengthened to teach the system:
- distill knowledge instead of flooding
- but do not collapse into flatness
- preserve expressive force when the prompt calls for vividness, robustness, or creativity

### Goal
Not:
- noisy overproduction
- sterile flatness

But:
- disciplined richness

---

## 6. Bone / Marrow / Spine heuristic architecture

A new multi-channel heuristic model was added.

### Bone
Represents:
- structural relevance
- prompt fidelity
- staying on topic
- prompt-following trust

### Marrow
Represents:
- creative robustness
- expressive vitality
- vividness
- non-blandness

### Spine
Represents:
- stitched integrated coherence between bone and marrow
- the balanced center of structural fidelity and expressive strength

### Why this matters
This lets the engine distinguish between:
- relevant but bland responses
- creative but off-prompt responses
- strong responses that are both structured and expressive

---

## 7. Stitch brackets for scale stability

To keep bone and marrow from drifting apart as memory volume grows, stitched stabilization logic was added.

### Added concepts
- bounded heuristic channels
- max allowed gap between bone and marrow
- stitched recomputation before retrieval weighting
- derived `spine` score

### Effect
This hardens the engine so the channels do not separate uncontrollably across large memory volumes.

---

## 8. Explicit post-response feedback reinforcement

A real feedback loop was added for local synthesis.

### Workflow
When the engine generates a local fallback answer, it remembers the exact records used.

If the next user message contains explicit evaluation such as:
- `that was great`
- `that was smart`
- `good response`
- `great response`
- `awesome`
- `creative`
- `not relevant`
- `too bland`
- `that sucked`
- `doesn't follow`

The system applies targeted reinforcement to the exact records used in the previous local answer.

### This means
Feedback is no longer generic. It updates the exact:
- seed records
- knowledgebase records
- memory records

that contributed to the prior local synthesis response.

---

## 9. Bone and marrow now receive separate feedback

The earlier single biometrics-style feedback was split into two channels.

### Bone feedback
Used for:
- `not relevant`
- `doesn't follow`
- prompt fidelity failures

### Marrow feedback
Used for:
- `too bland`
- `that sucked`
- `creative`
- `awesome`
- `that was smart`

### Result
The engine can now learn:
- structural quality separately
- creative quality separately

instead of flattening both into one undifferentiated score.

---

## 10. Memory quality protection layer

A protection layer was added to keep the memory bank from becoming noisy as it grows.

### Goals
- signal over volume
- stable knowledge over residue
- explicit feedback priority
- bounded heuristic drift
- retrieval-safe scaling

### Internal protection decisions now include
- whether to store
- storage mode
- compression level
- priority
- reasons

This reduces the chance that the engine becomes muddy as more interactions accumulate.

---

## 11. `memory` parameter introduced

A new parameter was added to `observe()` metadata:

```ts
memory?: boolean
```

### Meaning
- `memory = false` → **intuitive learning**
- `memory = true` → **finegrained learning**

---

## 12. Intuitive learning vs finegrained learning

### `memory = false` → intuitive learning
This means:
- dynamic
- broader
- more compressed
- lower noise
- better for foundational pattern capture

Used for:
- knowledge seeds
- knowledgebase-style stable system intelligence

### `memory = true` → finegrained learning
This means:
- more exact
- more detailed
- sharper retention
- better for explicit correction and future precision

Used for:
- ordinary cloud conversation learning
- detailed user-specific learning

---

## 13. Main observe() call sites were wired intentionally

### Seed injection
Core and extension seeds now explicitly use:

```ts
memory: false
```

So seed knowledge becomes:
- dynamic intuitive learning
- foundational
- less residue-heavy

### Ordinary successful cloud chat learning
The OpenRouter success path now explicitly uses:

```ts
memory: true
```

So regular learned conversational output becomes:
- finegrained learning
- more specific
- better for detailed recall and correction

---

## 14. Retrieval now respects learning mode

The retrieval system now biases memory records differently depending on whether they are:
- intuitive
- finegrained

### Intuitive memories
Used more as:
- broader support
- more stable pattern knowledge
- less literal precision recall

### Finegrained memories
Used more as:
- exact support
- detail-preserving recall
- higher precision retrieval material

---

## 15. `/api/chat` feedback loop integration

The non-stream chat route now implements explicit local synthesis reinforcement.

### How it works
- when the engine generates a local fallback answer, it stores the exact record trace in `localSynthesisFeedbackMap` for that session
- that trace contains `recordIds`, `confidence`, `supportLevel`, and a timestamp
- the trace is kept fresh for up to 10 minutes and is discarded after that
- the next user message is scanned for short evaluative feedback
- if phrases like `that was great`, `too bland`, `doesn't follow`, or `that sucked` are detected, the system computes a `boneDelta`/`marrowDelta`
- the exact prior local trace records are then updated using `synthesisEngine.applyBoneMarrowFeedback(...)`

### Why it matters
This is not generic reward shaping. The system adjusts the exact memory records used in the prior local answer, so local fallback learns from real conversational evaluation.

---

## 16. `/api/chat/stream` mirrored integration

The streaming chat route now mirrors the same reinforcement architecture.

### Stream-specific behavior
- `/api/chat/stream` first tries OpenRouter SSE streaming
- if streaming fails, it falls back to `generateWithFallback(...)`
- when the fallback provider is local, the route stores the local trace exactly like `/api/chat`
- later evaluative messages in stream mode apply feedback to the same trace via the same `localSynthesisFeedbackMap`

### Why this is state of the art
This ensures the local synthesis engine learns across both normal and SSE streaming traffic, instead of leaving stream as a one-shot fallback path.

---

## 17. Live local synthesis fallback architecture

The fallback path is implemented in `server/routes.ts` and `server/synthesis-engine.ts`.

### `generateWithFallback(...)`
- tries OpenRouter first
- on failure, activates local synthesis as the final fallback
- logs the fallback event and still stores the resulting local response with `synthesisEngine.observe(...)`
- local responses are stored with `memory: true`, `source: "conversation"`, and the current `ownerScope`

### `synthesizeLocalResponse(...)`
- is the always-available last-line-of-defense local composer
- it uses mode detection, system prompt augmentation, learned context injection, and guardrail-safe rendering
- it is intentionally not just a transcript re-player; it synthesizes answers from structured local knowledge

---

## 18. Engine internals: heuristic + retrieval + feedback

The synthesis engine now has:
- `observe(...)` to index responses with quality, learning mode, owner scope, and heuristic channels
- `synthesize(...)` to retrieve top neighbors, select seed vs memory matches, build a knowledge lens, and render a structured answer
- `applyBoneMarrowFeedback(...)` to update exact records with bone/marrow deltas and recompute record weight
- `debugRetrieve(...)` to expose rich retrieval debug data without mutating state
- `getStats(...)` to expose engine health, heuristic averages, learning-mode counts, and retrieval config

### Key implementation points
- local memory records store `boneScore`, `marrowScore`, `learningMode`, `weight`, and `usageCount`
- retrieval selection biases seed matches first, and memory matches second
- intuitive vs finegrained memory records are scored differently during selection
- the response is built from a `KnowledgeLens` rather than raw concatenated memory fragments

---

## 19. Diagnostics and debug inspection

The live system now exposes two inspectable synthesis endpoints:

- `GET /api/synthesis/stats`
  - returns total records, avg quality, avg weight, avg usage, heuristic profile, learning mode counts, and retrieval config
- `POST /api/synthesis/test-retrieval`
  - returns raw matched records, similarity scores, retrieval scores, quality, memory weight, learning mode, and `heuristicProfile` for each match

This makes the local synthesis layer fully inspectable during regression testing and post-mortem analysis.

---

## 20. Regression coverage for local synthesis

The smoke suite now validates the local synthesis feedback loop end-to-end:
- `/api/chat` local reinforcement via exact prior-trace feedback
- `/api/chat/stream` mirrored feedback and fallback trace capture
- `/api/synthesis/test-retrieval` debug retrieval auth and match visibility
- `/api/synthesis/stats` engine health and record counts

This gives the local intelligence layer robust coverage in the same suite that tests auth, session isolation, privacy, artifact pipelines, and SSE behavior.

---

## Summary

What was built is not just a fallback responder. It is now a shaped local intelligence architecture with:

- seed-first knowledge synthesis
- explicit separation of foundational seeds vs memory
- dynamic intuitive learning vs finegrained learning
- bone/marrow/spine heuristic channels
- stitched stabilization logic
- exact-record feedback reinforcement
- mirrored behavior across `/api/chat` and `/api/chat/stream`
- memory quality protection
- regression coverage through smoke tests

This significantly upgrades BetaGrace’s local synthesis from a memory-splicing fallback into a more coherent adaptive local reasoning layer.
