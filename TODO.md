# TODO — Local Fallback Fixes

## 1. `server/routes.ts` — `sanitizeAiResponse()` whitespace fix
- [x] Replace `.replace(/\s{2,}/g, " ")` with `.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n")`

## 2. `server/routes.ts` — drop the local-success `observe()` write
- [x] Remove the `try { synthesisEngine.observe(... "local" ...) }` block after local fallback success

## 3. `server/synthesis-engine.ts` — `_buildKnowledgeLens()` dedup fix
- [x] Change `if (firstSentence) pointSet.add(firstSentence);` to skip when it equals `overviewSource`

## 4. `server/synthesis-engine.ts` — seed-pool reservation fix
- [x] Replace naive `stage1.sort()` + `.slice()` with seed-reservation logic (reserve up to 30% of pool for seeds)

## 5. `server/synthesis-engine.ts` — `PROVIDER_BONUS` / `ProviderName` sync
- [x] Change providers from `gemini | huggingface | pollinations | local` to `openrouter | groq | local`

## 6. `server/synthesis-engine.ts` + `server/index.ts` — one-time legacy purge
- [x] Add `purgeLegacyLocalFallback()` method to engine
- [x] Call it once at boot after seed injection in `index.ts`

## 7. `server/routes.ts` — defer engine reply to final fallback (smart, not random)
- [x] Remove the early-return engine block so topic-specific templates get priority
- [x] Use the engine reply only as the final fallback after no topic matches
- [x] Route engine reply through `ensureFallbackResponse()` QA

## Verification
- [x] Type-check / build verification (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passes)
- [ ] Runtime check: `seeds in pool > 0`, `seedSupport` not pinned at `0.000`, no `###` mid-sentence, topic queries now return varied template responses
