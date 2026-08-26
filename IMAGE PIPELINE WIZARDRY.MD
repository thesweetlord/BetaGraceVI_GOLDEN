# BetaGrace vI - Image Pipeline Architecture & Verified Audit
*Verified against the repository on August 22, 2026*

## Executive Summary
This document records the image-generation behavior that is present in the codebase. The pipeline has two distinct prompt paths:

- Chat image requests use synthesis-enriched LLM context, an `[IMAGE: ...]` extraction hierarchy, and the general Pollinations image URL builder.
- Advanced image requests use the `/api/advanced-image` routes, explicit style profiles, optional source-image analysis, bounded strength/seed parameters, and the proxy stability layer. This is a real implemented route surface, but it is not the currently mounted Dashboard workflow.

These mechanisms improve prompt and source-image adherence, but the provider remains nondeterministic and output quality is not mathematically guaranteed. Claims below are marked as implemented behavior, conditional behavior, or a known limitation.

---

## Phase 1: Synthesis-Driven Chat Prompt Formulation
*Implemented in `server/routes.ts` and `server/synthesis-engine.ts`*

1. `wantsImage` detects image-oriented language and appends an `[IMAGE GENERATION ACTIVE]` instruction requiring a vivid tag covering subject, style, lighting, color palette, mood, and composition.
2. `enrichPromptWithSynthesis` runs before LLM generation and calls `synthesisEngine.synthesize(systemPrompt, userMessage, mode, sessionId)`.
3. The synthesis engine retrieves with Okapi BM25, re-ranks with composite relevance signals, selects sources with MMR, applies a coherence gate, and returns a deterministic fallback summary when the gate fails.
4. The result is inserted between `[LOCAL SYNTHESIS CONTEXT]` and `[END LOCAL SYNTHESIS CONTEXT]`. The returned trace records supporting memory IDs and confidence when retrieval finds support.

### Local Synthesis Wiring: Exact Rebuild Path

This is where LocalSynthesis is implemented and wired to work:

1. `server/synthesis-engine.ts` constructs the singleton `synthesisEngine`, loads `data/synthesis-memory.json`, rebuilds its in-memory inverted index, retrieves with BM25, re-ranks candidates, composes MMR context, applies the coherence gate, and provides the deterministic fallback summary.
2. `server/index.ts` imports `synthesisEngine` and `injectKnowledgeSeed`, calls `registerRoutes(app)`, then awaits `injectKnowledgeSeed(synthesisEngine)` during boot. Seed injection uses `engine.observe()` to populate foundational knowledge before requests arrive; failures are non-fatal by design.
3. `server/routes.ts` owns `enrichPromptWithSynthesis()`. It calls `synthesisEngine.synthesize()` before both synchronous and streaming chat generation and wraps the returned text in `[LOCAL SYNTHESIS CONTEXT]` markers.
4. `server/routes.ts` also owns `generateWithFallback()` and `synthesizeLocalResponse()`. The provider order must be preserved: cloud generation is attempted first, then local synthesis is the final fallback when cloud providers fail or are unavailable.
5. Successful cloud and local responses are sent back through `synthesisEngine.observe()` so future retrieval can learn from accepted conversations. `applyBoneMarrowFeedback()`, `scoreTurn()`, stats, debug retrieval, and force distillation are additional live engine integrations.

**Rebuild rule:** do not replace this with a prompt-only “local context” string. The working behavior depends on boot seed injection, persistent memory loading, in-memory index construction, pre-generation `synthesize()`, post-generation `observe()`, and the final local fallback path.

**Adherence boundary:** this enriches the LLM's prompt-writing context. It does not prove that an image provider will reproduce every lore or scene detail.

---

## Phase 2: Chat Prompt Extraction and Fallbacks
*Implemented in `server/routes.ts` (`extractImageTag`, `cleanUserMessageToPrompt`)*

The request path attempts, in order:

1. Extract `[IMAGE: ...]` from the AI response. The regex also matches a bold-wrapped tag in practice.
2. If no usable tag exists, clean the user message by removing common command words and punctuation noise. For a result of at least 10 characters, append `highly detailed, cinematic lighting, professional quality, vivid colors`.
3. For a short cleaned request, remove image tags from the AI prose, split into sentences, reject short/filler sentences, and use the first remaining sentence. If necessary, fall back to the raw user message.

This fallback hierarchy keeps generation possible when the LLM ignores the requested tag. It is sanitization, not semantic verification.
---

## Phase 3: Style Profiles, Negatives, and Constraint Reinforcement
*Implemented in `server/advanced-image-routes.ts`; utility in `server/constraint-ghosting.ts`*

1. `STYLE_CONFIG` currently defines `photo`, `cinema`, `anime`, `paint`, `sketch`, `render`, `pixel`, `watercolor`, `leonardo-da-vinci`, `michelangelo`, and `rembrandt`. Each profile supplies a positive style prompt, negative prompt, and Pollinations model ID.
2. Advanced positive prompts are formed as `subject + style prompt + masterpiece + high quality + detailed` for T2I. I2I uses the style prompt plus the same quality terms and passes the source URL in `image=`.
3. Image analysis may append targeted negative boosts such as `avoid color bleeding, maintain color separation`.
4. `buildNegativePromptWithGhosting` exists and converts comma-separated terms to `term (avoid)`.

**Verified limitation:** the advanced image URL builders currently use the profile negatives directly plus metric-derived boosts. `constraint-ghosting.ts` is not imported into this route in the inspected code, so ghosting is an available utility, not a guaranteed part of every advanced generation request.

---

## Phase 4: Routing, Dimensions, Strength, and Seeds
*Implemented in `server/advanced-image-routes.ts` and `client/src/components/BaseImageGenerator.tsx`*

1. The client sends T2I requests to `/api/advanced-image/text-to-image` and I2I requests to `/api/advanced-image/image-to-image`. It validates that source images are absolute HTTP(S) URLs before sending them.
2. The unmounted `BaseImageGenerator` client contains an NSFW branch for `/api/generate-nsfw-image`, returning a fixed 1024x1024/seed-0 display shape. No server implementation/registration for `/api/generate-nsfw-image` was found in this repository, so enabling that branch currently results in a missing endpoint rather than a working NSFW pipeline.
3. The advanced server route uses the selected profile's model, including `flux-realism`, `flux-anime`, `flux`, and `flux-3d`. The inspected advanced client does not select `gptimage`, `turbo`, or `seedream` through this path. Separately, the chat route validates and accepts `imageModel` values `flux`, `gptimage`, `turbo`, and `seedream`, then passes the selected value to its general image URL builder.
4. Advanced route defaults are 1536x1536. T2I defaults to a random seed unless supplied. I2I clamps strength to `[0, 1]`, defaults it to `0.1`, and uses a random seed unless supplied.
5. When I2I receives `baseStyleId=flux` and a non-empty `baseStylePrompt`, `computeSeedFromString` derives a repeatable seed in `[0, 999999]`. Without those conditions, the seed is random. A repeatable seed does not guarantee pixel-identical provider output.
6. The Flux base-style client option forwards `baseStyleId` and the relevant base prompt. The server uses these values for I2I seed derivation and guardrail checks; the advanced T2I route accepts the fields in the client payload but does not use them in the shown URL builder.

---

## Phase 5: Source-Image Metrics for T2I and I2I
*Implemented in `server/advanced-image-routes.ts` (`analyzeImageMetrics`)*

When `imageURL` is supplied to advanced T2I, and for every advanced I2I request, the server fetches the source image with a 15-second timeout unless metrics are already cached. It computes:

- `colorDensity`: normalized difference between average RGB channel values;
- `contrast`: normalized sum of pairwise average-channel differences;
- `complexity`: sampled luminosity jumps above a threshold;
- `brightness`: weighted average RGB brightness;
- `dominantColorCount`: quantized sampled color bucket count.

**Important accuracy note:** this function samples the encoded response buffer directly. It does not decode PNG/JPEG/WEBP into actual pixels, so these are encoded-byte heuristics rather than true pixel metrics. Cache entries are keyed by image URL and style through `imageMetricsCache`.

If fetching or analysis fails, generation continues without computed LoRA or metric-derived negative boosts. The source image is still passed to the I2I provider URL.

**Critical distinction:** an `imageURL` on the advanced T2I request is fetched for metrics only; `generateTextToImageURL` does not add it as an `image=` conditioning parameter. Actual source-image conditioning is the advanced I2I route's responsibility.

---

## Phase 6: Adaptive LoRA and Scene Anchors
*Implemented in `server/advanced-image-routes.ts` (`matchWeightsToImage`)*

1. The base LoRA weight starts at `0.7` and adjusts by the documented color-density, contrast, complexity, and brightness thresholds.
2. The result is clamped to `[0.3, 1.8]`, classified as subtle/moderate/strong, then modified by a style-model intensity map and clamped again.
3. Metric-dependent negative boosts target excessive complexity, color bleeding, and excessive darkness.
4. The function creates `main_char` at `(0.5, 0.7, 0)` with intensity `0.9` and pose lock `-0.1`, plus `key_light` at `(0.8, 0.6, 0.5)` with intensity `0.7`.

**Verified limitation:** these anchors are returned in the matching result and logged, but the inspected URL builders do not serialize `sceneAnchors` into the provider request. They are currently metadata, not an enforced spatial-control input.

---

## Phase 7: Optional Hand Validation and Retry Circuit
*Implemented in `server/advanced-image-routes.ts` (`generateImageWithHandValidation`)*

1. `validateGeneratedHands` fetches the generated image and invokes `detectHandsInImage` when `global.HandDetectionModel` exists.
2. It checks expected hand count, confidence below `0.7`, incomplete landmarks, fingertip spacing below `0.02`, and hand span outside `[0.05, 0.5]`.
3. Failed validation selects a matching `RETRY_STRATEGIES` entry, changes LoRA/fidelity/temperature through bounded `brainFunction` arithmetic, adds anatomy negatives where configured, and varies the seed. The loop allows the initial attempt plus up to `maxRetries` retries, three by default in the exported function.
4. If no hand model is installed, validation is explicitly skipped and returns a best-effort valid result with confidence `0.5`. The fallback detector itself returns no hands, but the outer function does not treat that as failure when the model is unavailable.

**Adherence boundary:** this validation is an exported capability and retry circuit. A repository-wide call-site check found only its import/export reference, with no invocation from the `/api/advanced-image` T2I or I2I route handlers, so it is not currently an automatic guard for those requests.

---

## Phase 8: Proxy Stability and Delivery
*Implemented in `server/routes.ts` (`/api/proxy-image`)*

1. The proxy disables browser/proxy caching with `Cache-Control: no-store` headers.
2. It retries up to three attempts with delays and a 45-second fetch timeout. 429 responses receive additional progressive waits; 402 responses immediately return `BALANCE_EXHAUSTED` without retrying.
3. It validates PNG, JPEG, and WEBP magic bytes before returning the buffer.
4. If the first payload is not a recognized image, it removes `private`, `model`, and `quality` from the parsed URL and tries a 12-second simplified fallback, validating its magic bytes as well.
5. The client wraps known Pollinations/R2 hosts through this proxy for both T2I and I2I results and adds a cache-busting query value for direct URLs.

---

## Fidelity Contract: What Is Preserved

For text-to-image adherence, preserve the synthesis context, tag extraction fallbacks, server-side guardrails, style-profile positive/negative composition, explicit dimensions, and proxy validation.

For image-to-image adherence, preserve the original source URL, bounded `strength`, explicit seed when reproducibility matters, source analysis and cache lookup, metric-derived LoRA/negative adjustments, and the provider `image=` parameter. A low strength generally favors source preservation; higher strength permits more transformation, so changing it is an intentional fidelity tradeoff.

Do not describe provider output as guaranteed, pixel-identical, decoded-pixel analyzed, ghosted, anchor-enforced, or hand-validated unless the corresponding code path is explicitly enabled and verified.

---

## Gap Register and Recommended Verification

The following are documented limitations rather than silently assumed guarantees:

1. Wire `buildNegativePromptWithGhosting` into the advanced URL builders if ghosting is required for T2I/I2I; add a focused test asserting the outgoing `negative` query contains `(avoid)`.
2. Serialize or consume `sceneAnchors` if spatial anchors are intended to affect provider generation; add a request-construction test.
3. Decode image formats before calculating metrics if true pixel-level analysis is required; test known PNG/JPEG/WEBP fixtures.
4. Register and exercise `global.HandDetectionModel` in an integration test before claiming anatomical validation is active in production.
5. Add route tests for: T2I defaults, I2I strength clamping, deterministic Flux seed conditions, source-fetch failure, 402/429 proxy behavior, and invalid magic bytes.

This audit was checked against the named implementation surfaces above. Re-run it whenever those routes, style profiles, prompt builders, or the client payload shape changes.

---

## Exact Rebuild Contract

Use this section as the minimum reconstruction specification if the working tree or deployment is lost. Preserve these files together; copying only the UI or only the URL builders will lose adherence behavior:

1. `server/routes.ts`: chat image detection, synthesis injection, tag extraction, fallback prompt cleaning, general chat model selection, proxy delivery, guardrails, and the `/api/proxy-image` stability layer.
2. `server/synthesis-engine.ts`: local memory retrieval, BM25 ranking, composite re-ranking, MMR selection, coherence gate, and deterministic fallback rendering.
3. `server/advanced-image-routes.ts`: `STYLE_CONFIG`, prompt URL builders, T2I/I2I route contracts, source analysis, LoRA matching, Flux seed derivation, strength clamping, session/age checks, and response metadata.
4. `server/image-cache.ts`: SHA-256 URL-plus-style cache key, 30-minute TTL, and 1,000-entry bound.
5. `server/constraint-ghosting.ts`: retained as an **inactive utility in the current advanced T2I/I2I pipeline**. It is not imported by `server/advanced-image-routes.ts`, so profile negatives are currently sent without `(avoid)` ghosting. Do not describe ghosting as active until it is explicitly imported into advanced URL construction and covered by a request-construction test.
6. `client/src/components/BaseImageGenerator.tsx`: payload routing, Flux base-style fields, absolute HTTP(S) source validation, NSFW branch, proxy wrapping, cache busting, and I2I strength controls.
7. `server/ai.ts` and `server/pipeline.ts`: preserve independently for video generation; their frame pipeline has its own negative prompts, seed drift, batch anchors, retries, and balance-exhaustion behavior and must not be confused with advanced still-image I2I.
8. `data/synthesis-memory.json`: preserve this file if narrative continuity and learned prompt context matter. Losing it does not remove image URL construction, but it removes the stored synthesis knowledge used to write richer image tags.
9. Dependency closure: preserve `server/guardrails.ts`, `server/storage.ts`, `server/db.ts`, `server/hand-detection.js`, `server/seed-extensions.ts`, `shared/schema.ts`, and `shared/db-schema.ts`. The advanced routes depend on guardrails, storage-backed session/age state, and hand-detection types; synthesis boot depends on seed extensions.
10. Route dependency closure: because `server/routes.ts` imports the full application surface, preserve its directly imported local modules, including `server/email.ts`, `server/aletheia-bridge.ts`, `server/parallel-learning.ts`, `server/video-compiler.ts`, `server/code-graph-analyzer.ts`, `server/video-engine-hydration.ts`, `server/academic-research-engine.ts`, and `server/legal-docs.ts`.
11. Runtime scaffold: preserve `package.json`, `tsconfig.json`, `vite.config.ts`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/pages/Dashboard.tsx`, and `server/static.ts`. These files determine dependency installation, TypeScript/Vite compilation, client mounting, and production asset serving.
12. Active UI wiring: preserve the `Dashboard` mount of `ChatInterface`. `BaseImageGenerator` and `AdvancedImageGenerator` currently have no active mount reference in the audited client, so they must be explicitly mounted if the advanced T2I/I2I workflow is intended to be user-accessible.

### Server Bootstrap and Registration Order

The exact startup path is `server/index.ts` -> `registerRoutes(app)` in `server/routes.ts` -> `registerAdvancedImageRoutes(app)` at the end of `registerRoutes`. Preserve this order. The legacy chat/image/proxy routes are registered before the advanced routes, and changing order can change which handler receives a request.

Before importing server modules, `server/index.ts` loads `dotenv/config`. It also configures Express with `trust proxy`, CORS credentials, JSON and URL-encoded body limits of 50 KB, API no-store cache headers, a 120-second request timeout, a 1,000-request concurrency ceiling, production HTTPS enforcement, and CSP/security headers. These are part of the working deployment contract, not image prompt logic, but they affect whether the image requests can reach the routes.

### Required Runtime Configuration

Keep the following configuration available when rebuilding, without committing secret values:

- `POLLINATIONS_API_KEY`: optional for the web image proxy; when present, the proxy attaches it for the supported Pollinations hosts.
- `OPENROUTER_API_KEY`: enables cloud text generation; without it, the application can fall back to local synthesis behavior.
- `OPENROUTER_TEXT_MODEL`: optional override for the cloud text model that writes image tags and chat responses.
- `DATABASE_URL`: enables PostgreSQL-backed sessions and storage. Development can start without it in the current bootstrap, but production session/storage behavior must be tested with it configured.
- `STABILITY_API_KEY`: required by the separate Python pipeline, not by the TypeScript web Pollinations image path.
- `SYNTHESIS_MEMORY_PATH`: optional override for the local synthesis memory file; otherwise the engine uses `data/synthesis-memory.json`.
- `RAG_ENABLED`: enables additional retrieval context when set to `true`; per-request `useRag` can also enable it.
- `PORT`: server listen port, defaulting to `5000`.
- `ADMIN_TOKEN` and `DEV_PASSWORD`: required only for protected developer/admin paths; do not expose or commit their values.
- `NODE_ENV`: changes database SSL, HTTPS enforcement, and CSP behavior; preserve the production value in deployment.

The repository does not contain a discoverable `.env.example` in the audited workspace. Create a local, untracked environment file or deployment secret configuration from the variable list above. Never copy an existing token into documentation or source control; rotate any credential that was exposed.

### Session, Age, and Request Security Contract

Advanced T2I and I2I require a valid session ID plus both `ageVerified` and `isOver18`. The advanced helper accepts header IDs beginning with `session_` and also reads the `sessionId` cookie. The client stores the session ID and age state in the persisted Zustand store, while `apiRequest` sends `X-Session-ID` and `credentials: include`.

The chat path has different session behavior and can auto-create/restore a missing session. Do not merge the chat and advanced session helpers during a rebuild without deliberately deciding the security behavior. Advanced T2I validates a provided source URL's HTTP(S) protocol before metric fetching; advanced I2I currently requires a string but does not perform the same server-side protocol/host validation before fetching it. This is a known SSRF/security gap, not an adherence feature. A hardened rebuild should add SSRF protections, redirect controls, response-size limits, and finite numeric validation while preserving valid public image URLs.

The proxy and styles endpoints are not themselves age-gated. The proxy also has its own host allowlist. Keep the server allowlist and client proxy detection synchronized, including Pollinations and R2 hosts, or valid generated images can fail at delivery.

### Active Legacy Image Workflow

The currently mounted `ChatInterface` also has a direct image mutation that calls `/api/generate-image`, separate from `/api/advanced-image/text-to-image`. Preserve its prompt/style guardrails, markdown cleanup, `ART_STYLES[0]` default behavior, `buildPollinationsImageUrl()` call, proxied response, and client state update. This legacy route is part of the current application even when the advanced component is not mounted.

### Chat Path Variants

The synchronous `/api/chat` path and streaming `/api/chat/stream` path are not identical:

- Synchronous chat calls `buildPollinationsImageUrl(promptForImg, null)` in the inspected branch and therefore uses the builder's default `flux` model, regardless of the separately persisted client model selection.
- Streaming chat validates `imageModel` against `flux`, `gptimage`, `turbo`, and `seedream`, emits text SSE events first, then performs image generation, and sends the resulting `imageUrl` in the final `done` event.
- Streaming image generation is not progressive image streaming. The image is created after the text stream and delivered as a URL.
- Preserve the client SSE parser and error handling behavior when rebuilding; do not assume ordinary JSON response handling is interchangeable.

### Canonical Client Surface

The currently mounted Dashboard UI is `client/src/components/ChatInterface.tsx`, imported by `client/src/pages/Dashboard.tsx`. Its active explicit-image workflow calls `/api/generate-image`; its chat workflow calls `/api/chat` or `/api/chat/stream` and displays the returned/proxied image. `client/src/components/BaseImageGenerator.tsx` contains the richer advanced T2I/I2I controls, but no active mount reference was found. Preserve both facts when rebuilding: reproducing the current application requires `ChatInterface`, while reproducing the available advanced image surface requires `BaseImageGenerator` and its route contracts.

`client/src/components/AdvancedImageGenerator.tsx` is a second unmounted implementation with different proxy detection and without the NSFW/Flux behavior. A rebuild must either preserve which component is actually mounted or intentionally remove/replace these duplicates; silently choosing either unmounted advanced component can lose current application behavior or adherence-related payload fields.

The client persists session state, age state, generated image/source values, chat messages, model preferences, `imageModel`, and `nsfwEnabled` through `client/src/lib/store.ts`. Advanced result metadata itself is not persisted. Preserve `client/src/lib/queryClient.ts` because it adds the session header and cookie credentials used by the protected routes.

### Known Numeric and Delivery Gaps

The current server checks only `typeof` for advanced `seed`, `width`, and `height`; it does not reject `NaN`, infinities, negative values, or extreme dimensions. I2I strength is clamped to `[0, 1]`, but the server default is `0.1` while the active client UI starts at `0.7`. Preserve those facts if reproducing the current build; validate and document any hardening change if making a safer rebuild.

The active client considers `images.pollinations.ai` and `.r2.cloudflarestorage.com` proxyable, while the server proxy allowlist must be checked separately. The fallback request also does not preserve the Pollinations authorization header. These delivery details can cause a correct generation URL to fail in the browser and must be covered by rebuild tests.

Still-image URLs and video preview URLs use different authentication paths: the still-image proxy adds `Authorization: Bearer ${POLLINATIONS_API_KEY}` for supported hosts, while video preview URL construction can append the key as a `key=` query parameter. Preserve these separately.

### Video Stack Boundary

The TypeScript web video path and the standalone Python pipeline are separate systems. `server/pipeline.ts` uses Pollinations frame downloads, full negative prompts, master/per-scene seed behavior, batch-level fallback copying, and a concurrency limit of three. Its `previousFramePath` and `img2imgStrength` arguments are currently ignored in `server/ai.ts` because the Pollinations POST I2I operation is unavailable; this is not true per-frame I2I conditioning. The Python `pipeline/` stack uses its own configuration and can require `STABILITY_API_KEY`. Do not rebuild either video path as proof that still-image I2I works.

### Required Request Contracts

**Chat image path:** detect the image intent, enrich the system prompt with synthesis, generate the AI response, extract `[IMAGE: ...]`, then call `buildPollinationsImageUrl()`. Streaming passes the validated `imageModel`; synchronous chat passes `null` for style and uses the builder's default `flux`. Keep the prompt limit at 1,400 encoded source characters, the 1024x1024 dimensions, `nologo=true`, `enhance=false`, and a random seed unless the behavior is intentionally changed.

**Advanced T2I:** send `{ prompt, style, seed?, width?, height?, imageURL? }` to `/api/advanced-image/text-to-image`. Sanitize only the leading `add image` command and surrounding quotes. Apply guardrails to the sanitized prompt. Preserve default 1536x1536 dimensions and random seed generation. If `imageURL` is present, analyze it for adaptive parameters but do not silently turn this route into I2I.

**Advanced I2I:** send `{ imageURL, style, strength, seed?, width?, height?, baseStyleId?, baseStylePrompt? }` to `/api/advanced-image/image-to-image`. Validate the source URL as HTTP(S), clamp `strength` to `[0, 1]`, preserve the source URL in the provider query as `image=`, and keep metric-derived `lora_weight` and negative boosts optional when analysis fails.

### Required Generation Invariants

- Positive T2I prompt: `subject, styleData.prompt, masterpiece, high quality, detailed`.
- Positive I2I prompt: `styleData.prompt, masterpiece, high quality, detailed` plus the source `image=` URL.
- Profile negatives remain attached to both advanced routes.
- `negativeBoost` is appended only when non-empty.
- Advanced model IDs come from `STYLE_CONFIG`; chat model IDs come from the validated `ALLOWED_IMAGE_MODELS` list.
- T2I and I2I responses retain `success`, `type`, `style`, `seed`, `width`, `height`, `imageUrl`, and their path-specific metadata such as `prompt`, `originalImageURL`, `strength`, `loraWeight`, and `negativeBoost`.
- Returned Pollinations/R2 images are routed through `/api/proxy-image` by the client, with cache-busting preserved.
- Do not enable claims about ghosting, scene anchors, decoded pixels, or automatic hand validation unless the implementation and tests are changed together.

### Rebuild Verification Gates

Run these gates in order after restoring dependencies and environment configuration:

```text
npm install
npm run check
npm run build
```

Before accepting the rebuild, verify all of the following with a test request or URL-construction test:

1. Chat output containing `[IMAGE: ...]` uses the tag rather than the raw user message.
2. Chat output without a tag uses cleaned user intent, then the prose fallback for short input.
3. Advanced T2I includes the subject, selected style prompt, profile negative, dimensions, and seed in its provider URL.
4. Advanced I2I includes the original `image=` URL, selected strength, profile negative, dimensions, and seed.
5. Repeating the same Flux I2I `baseStylePrompt` without an explicit seed returns the same derived seed; changing that prompt changes the seed in normal cases.
6. A failed source fetch still returns a generation URL rather than dropping the request.
7. A generated Pollinations response is proxied and rejected if it is not PNG, JPEG, or WEBP; 402 is surfaced without retry.
8. The restored `data/synthesis-memory.json` produces non-empty synthesis context for a known seeded memory query.
9. Registering routes through `server/index.ts` preserves the legacy-before-advanced order and starts with `dotenv/config` loaded.
10. A protected advanced request without a verified session is rejected, while the intended verified session succeeds.
11. Chat sync and chat stream are tested separately, including the stream's final `done` event containing `imageUrl`.
12. The client sends `X-Session-ID` and cookies through `apiRequest`, and the mounted Dashboard image surface remains `ChatInterface`; mount `BaseImageGenerator` explicitly only when exposing the advanced T2I/I2I route surface.
13. Proxy host allowlists agree between client and server for every provider URL the UI can receive.
14. `npm run check`, `npm run build`, and the focused image tests pass after dependencies and environment variables are restored.

The rebuild is not equivalent if any of these gates fail, even when the page loads and an image is returned.

---

## Seven-Pass Audit Record

This document has been checked against the repository in seven distinct passes:

1. **File existence:** every file named in the rebuild contract and dependency closure exists in the audited workspace.
2. **Route ownership:** chat, streaming chat, legacy image, proxy, and advanced routes were located and their registration order was checked.
3. **Prompt flow:** synthesis injection, tag extraction, fallback cleaning, style composition, negative composition, and provider URL encoding were traced.
4. **T2I/I2I separation:** advanced T2I metrics-only `imageURL` behavior was separated from advanced I2I `image=` conditioning; chat image paths were checked independently.
5. **State and security:** session headers, cookies, age verification, guardrails, NSFW routing, source URL handling, proxy allowlists, and numeric gaps were checked.
6. **Delivery and failure behavior:** cache control, cache-busting, proxy retries, magic bytes, 402/429 handling, source-analysis failure, and duplicate client behavior were checked.
7. **Rebuild closure:** bootstrap order, environment variables, TypeScript/Vite scaffolding, synthesis memory, video-stack boundaries, and focused acceptance gates were checked.

The result is a reconstruction specification for the current repository behavior, not a promise that a remote image provider will produce identical pixels. Any future adherence improvement must update the owning code, its focused test, and the corresponding contract above together.
