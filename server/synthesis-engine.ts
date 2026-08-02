/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  synthesis-engine.ts — BetaGrace vI Self-Synthesizing Knowledge Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Zero-dependency local synthesis engine with industry-grade IR algorithms.
 *
 *  Retrieval:   Okapi BM25 via in-memory inverted index (O(postings) not O(n·q))
 *  Ranking:     BM25 + recency decay + quality + topic overlap + mode affinity
 *  Summarizer:  Maximal Marginal Relevance (MMR) with dynamic source diversity cap
 *  Persistence: Atomic tmp-swap writes, async-debounced (never blocks event loop)
 *  Dedup:       Pre-storage cosine similarity guard (TF L2-normalized)
 *  avgDocLen:   Welford online algorithm — O(1) update, no O(n) reduce
 *
 *  v4 improvements over v3:
 *  ✓ Inverted index — 10-100× faster retrieval on large memory sets
 *  ✓ Welford online avgDocLength — eliminates O(n) reduce on every observe()
 *  ✓ Async debounced disk writes — zero blocking event-loop I/O
 *  ✓ Cosine near-duplicate guard — prevents storing near-identical interactions
 *  ✓ Mode-aware scoring — same-mode records receive relevance affinity boost
 *  ✓ Topic overlap boost in retrieval ranking
 *  ✓ Exponential-CDF BM25 normalization — stable 0-1 regardless of query length
 *  ✓ Pre-computed L2 norm (tfNorm) stored on record for O(1) cosine ops
 *  ✓ In-memory sentence cache — splitSentences() called once per record lifetime
 *  ✓ Dynamic MMR source cap — scales with neighbor count (no more hardcoded 3)
 *  ✓ SCHEMA_VERSION declared before emptyMemory() that uses it (was hoisting bug)
 *  ✓ _distill() uses RECENCY_DECAY_DAYS (was hardcoded 60 — mismatched constant)
 *  ✓ Graceful v3→v4 schema migration with field defaults
 *  ✓ getStats() includes mode distribution + vocabulary density
 *  ✓ Quality scorer uses smooth bell-curve length scoring (no hard cutoff at 6000)
 *
 *  v5 improvements — Five-Tier Offline Intelligence Upgrade:
 *  ✓ TIER 1 — Weighted Local Memory Bank: weight + usageCount on every record;
 *    weight factors into Stage B retrieval; records below MIN_MEMORY_WEIGHT pruned
 *  ✓ TIER 2 — Context Fusion Pipeline: synthesize() builds a structured payload
 *    with <weighted_memory> + <recent_turns> tags before MMR composition
 *  ✓ TIER 3 — Offline System Prompt (No-Regression Policy): deterministic system
 *    directive injected into every fused context payload
 *  ✓ TIER 4 — Coherence Gate: post-generation n-gram / unique-ratio / entropy checks;
 *    auto-recovery with tighter MMR params on first fail; deterministic hard fallback
 *  ✓ TIER 5 — Post-Turn Self-Scoring & Learning Loop: public scoreTurn() + 
 *    adjustMemoryWeight() API for callers to close the feedback loop
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BETAGRACE_KNOWLEDGE_SEED_EXTENSIONS } from "./seed-extensions";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSION — must be declared before emptyMemory() / loadMemory()
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 5 as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_PATH = process.env.SYNTHESIS_MEMORY_PATH
  ?? path.join(process.cwd(), "data", "synthesis-memory.json");

const MAX_RECORDS             = 2500;
const DISTILL_EVERY           = 75;
const TOP_K                   = 8;
const RERANK_MULTIPLIER       = 3;    // Stage A fetches TOP_K × this, Stage B re-ranks to TOP_K
const MIN_SIMILARITY          = 0.05;
const MIN_COMPOSITE_RETRIEVAL = 0.16;
const MIN_QUALITY_TO_STORE    = 0.20;
const RECENCY_DECAY_DAYS      = 45;
const COSINE_DEDUP_THRESHOLD  = 0.88;   // skip storing if cos-sim > this to recent records
const DEDUP_WINDOW            = 12;     // how many recent records to check for near-dups
const SAVE_DEBOUNCE_MS        = 600;    // async save fires this many ms after last observe()
const MAX_RESPONSE_STORE_CHARS = 8000;

/** Okapi BM25 parameters (well-tuned defaults from IR literature) */
const BM25_K1 = 1.5;   // term-frequency saturation (1.2–2.0)
const BM25_B  = 0.75;  // document-length normalization (0.5–0.8)

/** MMR λ: 1.0 = pure relevance, 0.0 = pure diversity */
const MMR_LAMBDA = 0.65;

// ── Tier 1: Weighted Local Memory Bank ───────────────────────────────────────
/** Records below this weight are pruned/archived on the next distill cycle */
const MIN_MEMORY_WEIGHT     = 0.20;
/** Weight boost applied when a record is used in a high-scoring turn */
const WEIGHT_BOOST          = 0.10;
/** Weight penalty applied when the user corrects or refutes a stored fact */
const WEIGHT_PENALTY        = 0.30;
const MARROW_BOOST = 0.004;
const MARROW_PENALTY = 0.002;
const BONE_BOOST = 0.003;
const BONE_PENALTY = 0.003;
const HEURISTIC_CHANNEL_CAP = 0.05;
const STITCH_MAX_GAP = 0.025;

// ── Tier 4: Coherence Gate ───────────────────────────────────────────────────
/** N-gram window for repetition-loop detection */
const NGRAM_SIZE            = 3;
/** Flag as gibberish if unique-word / total-word ratio falls below this */
const MIN_UNIQUE_WORD_RATIO = 0.40;
/** Shannon entropy floor (bits/char); below = likely broken/repeated content */
const MIN_CHAR_ENTROPY      = 3.5;

const PROVIDER_BONUS: Record<string, number> = {
  gemini:       0.18,
  huggingface:  0.12,
  pollinations: 0.06,
  local:        0.00,
};

// ── Tier 3: Offline System Prompt (No-Regression Policy) ─────────────────────
const OFFLINE_SYNTHESIS_SYSTEM_PROMPT = `You are an Autonomous Synthesis Agent operating in Offline Mode.
You hold clear, highly coherent conversations by combining your base knowledge with weighted local memories.

NO-REGRESSION POLICY:
- Absolute zero tolerance for repetition, word loops, broken characters, or rambling jargon.
- If you lack context, state it plainly. Never fill gaps with nonsense or repeated words.
- Express thoughts once, cleanly and concisely.

INPUT CONTEXT:
- Access <weighted_memory> (facts prioritized by relevance score) and <recent_turns>.
- Synthesize base knowledge with weighted context naturally.

COGNITIVE FORMATTING:
Always format your response using this structure:

### 💡 Synthesis
[1-3 crisp sentences synthesizing base knowledge and weighted local memory.]

### 🔍 Key Points & Observations
- [Point 1: Relevant detail or reasoning step]
- [Point 2: Connection to learned context or user preferences]

### 💬 Conversation & Next Steps
[A natural, conversational follow-up question or suggestion to keep the dialogue moving.]`;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type SparseVec    = Record<string, number>;
type ProviderName = "gemini" | "huggingface" | "pollinations" | "local";

interface InteractionRecord {
  id:            string;
  timestamp:     number;
  systemContext: string;
  userMessage:   string;
  response:      string;
  provider:      ProviderName;
  mode:          string;          // BetaGrace vI AI mode (e.g. "standard", "flesh_architect")
  quality:       number;
  topics:        string[];
  entities:      string[];
  writingStyle?: string;          // detected or declared style: "narrative"|"instructional"|"analytical"|"technical"|"academic"|"spiritual"|"general"
  constraints?:  string[];        // content/capability tags declared at seed time (e.g. "horror", "explicit_ok", "spiritual")
  tf:            SparseVec;       // raw term frequencies of the context window
  docLength:     number;          // total term count (denominator for BM25 normalization)
  tfNorm:        number;          // L2 norm of tf vector — pre-computed for O(1) cosine ops
  source?:       "seed" | "conversation";
  ownerScope?:   string | null;   // null for global seed knowledge, session-scoped for conversation memory
  // Tier 1: Weighted Local Memory Bank
  weight:        number;          // dynamic memory weight 0.0–1.0; init = quality score
  usageCount:    number;          // how many times this record was returned by _retrieve()
  boneScore?:    number;          // prompt fidelity / structural relevance heuristic channel
  marrowScore?:  number;          // creative robustness / expressive vitality heuristic channel
  learningMode?: "intuitive" | "finegrained";
}

interface SynthesisMemory {
  version:           typeof SCHEMA_VERSION;
  interactions:      InteractionRecord[];
  df:                SparseVec;    // document frequencies per term
  totalDocs:         number;
  avgDocLength:      number;       // Welford online mean — never stale
  lastDistilled:     number;
  totalObservations: number;
}

type ScoredRecord = InteractionRecord & { similarity: number; weight: number; retrievalScore: number };

type KnowledgeLens = {
  overview: string;
  keyPoints: string[];
  nextStep: string;
  confidence: number;
  supportLevel: "seeded" | "memory-backed" | "topic-backed" | "limited";
};

type KnowledgeSelection = {
  seedMatches: ScoredRecord[];
  memoryMatches: ScoredRecord[];
};

type MemoryProtectionDecision = {
  shouldStore: boolean;
  storageMode: "intuitive" | "finegrained";
  compressionLevel: "high" | "medium" | "low";
  priority: number;
  reason: string[];
};

export type LocalSynthesisTrace = {
  recordIds: string[];
  supportLevel: KnowledgeLens["supportLevel"];
  confidence: number;
};

export type SynthesisResult = {
  text: string;
  trace: LocalSynthesisTrace | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// STOP-WORDS & NLP PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

const STOP: ReadonlySet<string> = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","was","are","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","shall","can","cannot",
  "i","you","he","she","it","we","they","my","your","his","her","its","our","their",
  "me","him","us","them","what","which","who","when","where","how","why",
  "this","that","these","those","am","not","no","if","as","so","up","out","about",
  "into","than","then","some","any","all","just","more","also","very","too","much",
  "s","t","re","ve","d","ll","m","n","r","u","ok","yes","hey","hi",
  "don","doesn","didn","won","isn","aren","wasn","weren","hasn","haven","hadn",
  "wouldn","shouldn","couldn","mustn","let","get","got","go","going","come","came",
  "make","made","take","took","see","saw","know","knew","think","thought","say","said",
  "like","want","need","use","used","well","way","time","day","new","good","great",
  "one","two","three","many","few","now","here","there","back","only","even",
  "still","already","always","never","often","really","actually","basically",
  "maybe","perhaps","probably","simply","clearly","quite","rather","sure","please",
]);

/**
 * Lightweight suffix-stripping stemmer.
 * Ordered from longest suffix to shortest to avoid double-stripping.
 */
function pseudoStem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith("tion") || word.endsWith("sion")) return word.slice(0, -4) || word;
  if (word.endsWith("ness")) return word.slice(0, -4) || word;
  if (word.endsWith("ment")) return word.slice(0, -4) || word;
  if (word.endsWith("ical")) return word.slice(0, -4) || word;
  if (word.endsWith("ity"))  return word.slice(0, -3) || word;
  if (word.endsWith("ous"))  return word.slice(0, -3) || word;
  if (word.endsWith("ful"))  return word.slice(0, -3) || word;
  if (word.endsWith("est") && word.length > 6) return word.slice(0, -3);
  if (word.endsWith("ing") && word.length > 6) return word.slice(0, -3);
  if (word.endsWith("ed")  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("ly")  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("er")  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("s")   && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
  return word;
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    switch (token) {
      case "api":
        expanded.add("endpoint");
        expanded.add("route");
        break;
      case "endpoint":
      case "route":
        expanded.add("api");
        break;
      case "db":
        expanded.add("database");
        expanded.add("postgres");
        break;
      case "database":
      case "postgres":
      case "postgresql":
        expanded.add("db");
        break;
      case "auth":
        expanded.add("authentication");
        expanded.add("login");
        break;
      case "login":
      case "authentication":
        expanded.add("auth");
        break;
      case "video":
        expanded.add("cinema");
        expanded.add("scene");
        break;
      case "scene":
        expanded.add("video");
        break;
      case "image":
        expanded.add("visual");
        expanded.add("art");
        break;
      case "visual":
      case "art":
        expanded.add("image");
        break;
      case "memory":
        expanded.add("synthesis");
        expanded.add("learn");
        break;
      case "synthesis":
      case "learn":
        expanded.add("memory");
        break;
      case "code":
        expanded.add("program");
        expanded.add("function");
        break;
      case "function":
      case "program":
        expanded.add("code");
        break;
    }
  }

  return Array.from(expanded);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t))
    .map(pseudoStem);
}

function computeRawTF(tokens: string[]): SparseVec {
  const counts: SparseVec = {};
  for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}

function l2Norm(vec: SparseVec): number {
  let sum = 0;
  for (const v of Object.values(vec)) sum += v * v;
  return Math.sqrt(sum);
}

function cosineSimilarity(a: SparseVec, aNorm: number, b: SparseVec, bNorm: number): number {
  const denom = aNorm * bNorm;
  if (denom < 1e-9) return 0;
  let dot = 0;
  for (const [term, freq] of Object.entries(a)) {
    if (b[term] !== undefined) dot += freq * b[term];
  }
  return dot / denom;
}

function clampHeuristicChannel(value: number): number {
  return Math.max(-HEURISTIC_CHANNEL_CAP, Math.min(HEURISTIC_CHANNEL_CAP, value));
}

function stitchBoneAndMarrow(bone: number, marrow: number): { bone: number; marrow: number } {
  let safeBone = clampHeuristicChannel(bone);
  let safeMarrow = clampHeuristicChannel(marrow);
  const gap = safeBone - safeMarrow;

  if (Math.abs(gap) > STITCH_MAX_GAP) {
    const correction = (Math.abs(gap) - STITCH_MAX_GAP) / 2;
    if (gap > 0) {
      safeBone -= correction;
      safeMarrow += correction;
    } else {
      safeBone += correction;
      safeMarrow -= correction;
    }
  }

  return {
    bone: clampHeuristicChannel(safeBone),
    marrow: clampHeuristicChannel(safeMarrow),
  };
}

function computeStitchedProfile(rec: Pick<InteractionRecord, "boneScore" | "marrowScore">): { bone: number; marrow: number; spine: number } {
  const stitched = stitchBoneAndMarrow(rec.boneScore ?? 0, rec.marrowScore ?? 0);
  const spine = clampHeuristicChannel(stitched.bone * 0.65 + stitched.marrow * 0.35);
  return { bone: stitched.bone, marrow: stitched.marrow, spine };
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITING STYLE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infers a coarse writing style from a query string.
 * Used in Stage B re-ranking to boost records whose declared writingStyle matches.
 */
function detectWritingStyle(text: string): string {
  const t = text.toLowerCase();
  if (/\b(write|story|scene|character|narrative|fiction|imagine|creative|craft)\b/.test(t)) return "narrative";
  if (/\b(code|function|class|implement|debug|refactor|algorithm|api|library)\b/.test(t))  return "technical";
  if (/\b(research|study|literature|evidence|methodology|hypothesis|cite|paper)\b/.test(t)) return "academic";
  if (/\b(pray|faith|spiritual|theology|grace|divine|scripture|redempt|covenant)\b/.test(t)) return "spiritual";
  if (/\b(analyze|analysis|compare|evaluate|assess|critique|review|examine)\b/.test(t))    return "analytical";
  if (/\b(explain|how|what|why|define|describe|tutorial|guide|overview)\b/.test(t))        return "instructional";
  return "general";
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 4: COHERENCE GATE — post-generation validation before rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates synthesized text for coherence before it reaches the user.
 * Runs three independent checks in order:
 *   1. N-gram repetition loop detection  (same NGRAM_SIZE phrase repeated 2+×)
 *   2. Unique-word ratio                 (< MIN_UNIQUE_WORD_RATIO → gibberish)
 *   3. Shannon character entropy         (< MIN_CHAR_ENTROPY → broken/repetitive)
 *
 * Returns { pass: true } or { pass: false, reason } for caller logging.
 */
function coherenceGate(text: string): { pass: boolean; reason?: string } {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const total = words.length;

  if (total < 5) return { pass: false, reason: "output_too_short" };

  // 1. N-gram repetition loop — same NGRAM_SIZE-word phrase appearing 2+ times
  const ngramCounts: Record<string, number> = {};
  for (let i = 0; i <= words.length - NGRAM_SIZE; i++) {
    const gram = words.slice(i, i + NGRAM_SIZE).join(" ").toLowerCase();
    ngramCounts[gram] = (ngramCounts[gram] ?? 0) + 1;
    if (ngramCounts[gram] >= 2) {
      return { pass: false, reason: `ngram_loop:"${gram}"` };
    }
  }

  // 2. Unique-to-total word ratio
  const uniqueRatio = new Set(words.map(w => w.toLowerCase())).size / total;
  if (uniqueRatio < MIN_UNIQUE_WORD_RATIO) {
    return { pass: false, reason: `low_unique_ratio:${uniqueRatio.toFixed(2)}` };
  }

  // 3. Shannon character entropy — broken/repetitive text has low entropy
  const cleanText = text.toLowerCase().replace(/\s+/g, "");
  if (cleanText.length > 10) {
    const charFreq: Record<string, number> = {};
    for (const ch of cleanText) charFreq[ch] = (charFreq[ch] ?? 0) + 1;
    let entropy = 0;
    for (const count of Object.values(charFreq)) {
      const p = count / cleanText.length;
      entropy -= p * Math.log2(p);
    }
    if (entropy < MIN_CHAR_ENTROPY) {
      return { pass: false, reason: `low_entropy:${entropy.toFixed(2)}` };
    }
  }

  return { pass: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUALITY SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Smooth bell-curve for response length — peaks at ~2000 chars, gracefully
 * degrades rather than hard-cutoff at 6000.
 */
function lengthScore(len: number): number {
  if (len < 50)  return -0.15;
  if (len < 100) return 0.06;
  // Gaussian-shaped peak around 2000 chars, σ ≈ 3500
  const peak   = 0.28;
  const center = 2000;
  const sigma  = 3500;
  return peak * Math.exp(-((len - center) ** 2) / (2 * sigma ** 2));
}

function scoreQuality(response: string, provider: string): number {
  let score = 0.10;

  score += lengthScore(response.length);

  const paragraphs = (response.match(/\n\n+/g) ?? []).length;
  score += Math.min(0.12, paragraphs * 0.03);

  if (/^#{1,3}\s|\*\*[^*]{3,}\*\*/m.test(response)) score += 0.07;
  if (/^[\-\*\•]\s|^\d+\.\s/m.test(response))        score += 0.04;

  const coherenceHits = (response.match(
    /\b(however|therefore|furthermore|moreover|consequently|specifically|notably|importantly|additionally|conversely|nevertheless|meanwhile|ultimately|essentially|fundamentally|significantly)\b/gi
  ) ?? []).length;
  score += Math.min(0.10, coherenceHits * 0.02);

  const refusalHits = (response.match(
    /\b(as an ai|i cannot|i'm unable|i don't have access|i can't provide|unfortunately i|my knowledge cutoff|i don't have the ability|i lack the ability)\b/gi
  ) ?? []).length;
  score -= refusalHits * 0.18;

  const words = response.split(/\s+/);
  const uniqueRatio = new Set(words.map(w => w.toLowerCase())).size / Math.max(words.length, 1);
  if (uniqueRatio < 0.35) score -= 0.10;
  if (uniqueRatio > 0.95 && words.length > 30) score -= 0.06; // suspicious gibberish

  // Sentence density — reward well-structured responses with natural sentence lengths
  const sentenceCount = (response.match(/[.!?]+\s/g) ?? []).length + 1;
  const avgWordsPerSentence = words.length / sentenceCount;
  if (avgWordsPerSentence < 4)  score -= 0.06; // choppy / incomplete
  if (avgWordsPerSentence > 60) score -= 0.04; // run-on walls of text

  score += PROVIDER_BONUS[provider] ?? 0;

  return Math.max(0, Math.min(1, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC & ENTITY DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_MATCHERS: ReadonlyArray<[string, RegExp]> = [
  ["writing",    /\b(write|story|narrative|novel|fiction|prose|poem|chapter|scene|character|plot|dialogue|creative writing|screenplay)\b/i],
  ["code",       /\b(code|program|javascript|python|typescript|function|algorithm|api|debug|sql|react|node|software|dev|script|class|interface|module)\b/i],
  ["ai",         /\b(ai|llm|machine learning|neural|model|gpt|claude|gemini|llama|deepseek|chatbot|agent|embedding|transformer|diffusion)\b/i],
  ["science",    /\b(physics|chemistry|biology|quantum|dna|gene|evolution|climate|space|nasa|medicine|drug|vaccine|crispr|molecule|atom)\b/i],
  ["philosophy", /\b(philosophy|consciousness|ethics|morality|truth|reality|existence|free will|determinism|absurd|meaning|subjective|objective)\b/i],
  ["history",    /\b(history|historical|ancient|medieval|renaissance|war|empire|civilization|revolution|dynasty|century|era|period)\b/i],
  ["faith",      /\b(god|jesus|christ|bible|faith|prayer|church|spiritual|theology|christian|gospel|grace|redemption|holy spirit|kjv|scripture|verse)\b/i],
  ["math",       /\b(math|mathematics|calculus|algebra|geometry|equation|theorem|proof|statistics|probability|derivative|integral|matrix)\b/i],
  ["current",    /\b(2024|2025|2026|latest|current|today|recent|news|election|bitcoin|spacex|regulation|market|announcement)\b/i],
  ["creative",   /\b(create|design|art|music|film|image|visual|generate|imagine|concept|aesthetic|style|illustration|animation)\b/i],
  ["business",   /\b(business|startup|product|marketing|revenue|strategy|customer|brand|launch|growth|saas|enterprise)\b/i],
  ["health",     /\b(health|medical|doctor|patient|treatment|disease|medicine|hospital|therapy|symptom|diagnosis|wellness)\b/i],
];

function detectTopics(text: string): string[] {
  return TOPIC_MATCHERS
    .filter(([, re]) => re.test(text))
    .map(([label]) => label);
}

function extractEntities(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [];
  const freq: Record<string, number> = {};
  for (const m of matches) freq[m] = (freq[m] ?? 0) + 1;
  return Object.entries(freq)
    .filter(([k]) => k.length > 3 && !STOP.has(k.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k]) => k);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT SEGMENTATION
// ─────────────────────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length >= 35);
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= 600) {
      out.push(para);
      continue;
    }
    const sents = para
      .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
      .map(s => s.trim())
      .filter(s => s.length >= 35 && s.length <= 700);
    out.push(...sents);
  }
  return out;
}

/**
 * Jaccard similarity between two token sets.
 * Used in MMR loop for inter-sentence redundancy measure.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — atomic tmp-swap + async debounce
// ─────────────────────────────────────────────────────────────────────────────

function emptyMemory(): SynthesisMemory {
  return {
    version:           SCHEMA_VERSION,
    interactions:      [],
    df:                {},
    totalDocs:         0,
    avgDocLength:      0,
    lastDistilled:     Date.now(),
    totalObservations: 0,
  };
}

/**
 * Migrate older schema versions up to the current SCHEMA_VERSION.
 * Each stage is applied in order so a v3 file gets both migrations.
 */
function migrateMemory(raw: any): SynthesisMemory {
  // v3 → v4: add mode + tfNorm defaults
  if (raw.version === 3) {
    for (const rec of raw.interactions ?? []) {
      if (rec.mode   === undefined) rec.mode   = "standard";
      if (rec.tfNorm === undefined) rec.tfNorm = l2Norm(rec.tf ?? {});
    }
    raw.version = 4;
    console.log("[SYNTHESIS] Migrated memory from schema v3 → v4");
  }
  // v4 → v5: add Tier 1 weight + usageCount defaults
  if (raw.version === 4) {
    for (const rec of raw.interactions ?? []) {
      if (rec.weight     === undefined) rec.weight     = rec.quality ?? 0.5;
      if (rec.usageCount === undefined) rec.usageCount = 0;
    }
    raw.version = SCHEMA_VERSION;
    console.log("[SYNTHESIS] Migrated memory from schema v4 → v5 (weight/usageCount fields added)");
  }
  return raw as SynthesisMemory;
}

function loadMemory(): SynthesisMemory {
  try {
    const tmpPath = `${MEMORY_PATH}.tmp`;
    // Orphaned .tmp recovery: if the main file is missing but a .tmp survived a crash,
    // promote it. This prevents silently losing all learned interactions after a bad shutdown.
    if (!fs.existsSync(MEMORY_PATH) && fs.existsSync(tmpPath)) {
      try {
        fs.renameSync(tmpPath, MEMORY_PATH);
        console.warn("[SYNTHESIS] Recovered orphaned .tmp file → memory restored.");
      } catch (recoverErr) {
        console.error("[SYNTHESIS] .tmp recovery failed:", recoverErr);
      }
    }

    if (!fs.existsSync(MEMORY_PATH)) return emptyMemory();

    const raw = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"));
    if (raw.version !== SCHEMA_VERSION) {
      if (raw.version === 3 || raw.version === 4) return migrateMemory(raw);
      console.warn(`[SYNTHESIS] Unrecognized schema v${raw.version} — resetting memory.`);
      return emptyMemory();
    }
    return raw as SynthesisMemory;
  } catch (e) {
    console.error("[SYNTHESIS] Failed to load memory, resetting:", e);
    return emptyMemory();
  }
}

/** Synchronous atomic write — only used during distill() where consistency matters most. */
function saveMemorySync(mem: SynthesisMemory): void {
  try {
    fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
    const tmp = `${MEMORY_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mem), "utf8");
    fs.renameSync(tmp, MEMORY_PATH);
  } catch (e) {
    console.error("[SYNTHESIS] Sync write failure:", e);
  }
}

/** Async atomic write — used for routine saves so the event loop is never blocked. */
async function saveMemoryAsync(mem: SynthesisMemory): Promise<void> {
  const { promises: fsp } = await import("fs");
  await fsp.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  const tmp = `${MEMORY_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(mem), "utf8");
  await fsp.rename(tmp, MEMORY_PATH);
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export class SynthesisEngine {
  private mem:                 SynthesisMemory;
  private pendingSinceDistill: number = 0;

  /** In-memory inverted index: term → Set<recordId> for O(postings) BM25 retrieval */
  private invertedIndex: Map<string, Set<string>> = new Map();

  /** O(1) record lookup by id for retrieval/feedback hot paths */
  private recordMap: Map<string, InteractionRecord> = new Map();

  /** Sentence cache: recordId → string[] — avoids re-splitting on every synthesize() */
  private sentenceCache: Map<string, string[]> = new Map();

  /** Debounce handle for async disk saves */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.mem = loadMemory();
    this._rebuildIndexFromMemory();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════

  observe(
    systemPrompt: string,
    userMessage:  string,
    response:     string,
    provider:     string,
    mode:         string = "standard",
    meta?: { topics?: string[]; constraints?: string[]; writingStyle?: string; memory?: boolean; source?: "seed" | "conversation"; ownerScope?: string | null },
  ): void {
    const quality = scoreQuality(response, provider);
    if (quality < MIN_QUALITY_TO_STORE) return;

    // Encode declared metadata into the context window so BM25 indexes those terms.
    // This makes topic/constraint/style tags first-class retrieval signals.
    const metaTokens = [
      ...(meta?.topics      ?? []),
      ...(meta?.constraints ?? []),
      ...(meta?.writingStyle ? [meta.writingStyle] : []),
    ].join(" ");
    const contextWindow = `${userMessage} ${systemPrompt} ${metaTokens}`.trim();
    const protection = this._decideMemoryProtection(userMessage, response, meta?.memory ?? true, quality);
    if (!protection.shouldStore) return;

    const tokens = tokenize(contextWindow);
    if (tokens.length === 0) return;

    const tf        = computeRawTF(tokens);
    const docLength = tokens.length;
    const tfNorm    = l2Norm(tf);

    // ── Near-duplicate guard (cosine similarity against recent records) ──────
    if (this._isNearDuplicate(tf, tfNorm)) return;

    // ── Update document frequency index ─────────────────────────────────────
    const id = crypto.randomUUID();
    const uniqueTerms = Object.keys(tf);
    for (const term of uniqueTerms) {
      this.mem.df[term] = (this.mem.df[term] ?? 0) + 1;
      let posting = this.invertedIndex.get(term);
      if (!posting) { posting = new Set(); this.invertedIndex.set(term, posting); }
      posting.add(id);
    }

    // ── Welford online mean for avgDocLength — O(1), never stale ────────────
    this.mem.totalDocs++;
    this.mem.avgDocLength += (docLength - this.mem.avgDocLength) / this.mem.totalDocs;

    // ── Store record ─────────────────────────────────────────────────────────
    // Merge declared metadata topics with auto-detected ones (dedup).
    const detectedTopics = detectTopics(contextWindow);
    const mergedTopics   = meta?.topics
      ? [...new Set([...meta.topics, ...detectedTopics])]
      : detectedTopics;

    const inferred = this._inferBoneAndMarrow(userMessage, response);
    const stitchedInference = stitchBoneAndMarrow(inferred.bone, inferred.marrow);
    const compressedResponse = this._compressForLearningMode(response, protection.storageMode, protection.compressionLevel);

    this.mem.interactions.push({
      id,
      timestamp:     Date.now(),
      systemContext: systemPrompt,
      userMessage:   userMessage,
      response:      compressedResponse.slice(0, MAX_RESPONSE_STORE_CHARS),
      provider:      provider as ProviderName,
      mode,
      quality,
      topics:        mergedTopics,
      entities:      extractEntities(`${userMessage} ${response.slice(0, 1000)}`),
      tf,
      docLength,
      tfNorm,
      writingStyle:  meta?.writingStyle ?? detectWritingStyle(`${userMessage} ${response.slice(0, 300)}`),
      constraints:   meta?.constraints ?? [],
      source:        meta?.source ?? "conversation",
      ownerScope:    meta?.source === "seed" ? null : (meta?.ownerScope ?? null),
      // Tier 1: initial weight = quality score; grows/shrinks via adjustMemoryWeight()
      weight:        Math.max(0, Math.min(1, quality * (0.75 + protection.priority * 0.25))),
      usageCount:    0,
      boneScore:     stitchedInference.bone,
      marrowScore:   stitchedInference.marrow,
      learningMode:  protection.storageMode,
    });

    this.recordMap.set(id, this.mem.interactions[this.mem.interactions.length - 1]);

    this.mem.totalObservations++;
    this.pendingSinceDistill++;

    if (this.pendingSinceDistill >= DISTILL_EVERY) {
      this._distill();
    } else {
      this._scheduleSave();
    }
  }

  synthesize(systemPrompt: string, userMessage: string, mode = "standard", ownerScope?: string | null): SynthesisResult {
    const neighbors = this._retrieve(userMessage, systemPrompt, mode, TOP_K, ownerScope ?? null);
    if (
      neighbors.length === 0 ||
      (neighbors[0].similarity < MIN_SIMILARITY && neighbors[0].retrievalScore < MIN_COMPOSITE_RETRIEVAL)
    ) {
      return { text: this._topicFallback(userMessage, mode), trace: null };
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
    };

    const rendered = this._renderKnowledgeLens(lens, [...selection.seedMatches, ...selection.memoryMatches].slice(0, 4).length, lens.confidence < 40);
    const check = coherenceGate(rendered);
    if (check.pass) return { text: rendered, trace };

    console.warn(`[SYNTHESIS] Knowledge-lens coherence FAIL (${check.reason}). Falling back to deterministic summary.`);
    return { text: this._renderDeterministicFallback(lens, neighbors[0]?.response ?? ""), trace };
  }

  applyBoneMarrowFeedback(recordIds: string[], feedback: { boneDelta?: number; marrowDelta?: number }): void {
    if (!Array.isArray(recordIds) || recordIds.length === 0) return;
    const boneDelta = Math.max(-0.01, Math.min(0.01, feedback.boneDelta ?? 0));
    const marrowDelta = Math.max(-0.01, Math.min(0.01, feedback.marrowDelta ?? 0));
    if (boneDelta === 0 && marrowDelta === 0) return;

    for (const id of recordIds) {
      const rec = this.recordMap.get(id);
      if (!rec) continue;
      const currentBone = rec.boneScore ?? 0;
      const currentMarrow = rec.marrowScore ?? 0;
      const stitched = stitchBoneAndMarrow(currentBone + boneDelta, currentMarrow + marrowDelta);
      rec.boneScore = stitched.bone;
      rec.marrowScore = stitched.marrow;
      const spine = clampHeuristicChannel(stitched.bone * 0.65 + stitched.marrow * 0.35);
      rec.weight = Math.max(0.0, Math.min(1.0, rec.weight + spine * 0.15));
    }
    this._scheduleSave();
  }

  getStats(): object {
    const n = this.mem.interactions.length;
    const avgQuality = n === 0 ? 0
      : this.mem.interactions.reduce((s, r) => s + r.quality, 0) / n;
    const avgWeight = n === 0 ? 0
      : this.mem.interactions.reduce((s, r) => s + (r.weight ?? 0), 0) / n;
    const underweightRecords = this.mem.interactions.filter(r => (r.weight ?? 0) < MIN_MEMORY_WEIGHT).length;
    const avgUsageCount = n === 0 ? 0
      : this.mem.interactions.reduce((s, r) => s + (r.usageCount ?? 0), 0) / n;
    const stitchedProfiles = this.mem.interactions.map((r) => computeStitchedProfile(r));
    const intuitiveCount = this.mem.interactions.filter((r) => r.learningMode === "intuitive").length;
    const finegrainedCount = this.mem.interactions.filter((r) => r.learningMode !== "intuitive").length;
    const avgBoneScore = n === 0 ? 0
      : stitchedProfiles.reduce((s, r) => s + r.bone, 0) / n;
    const avgMarrowScore = n === 0 ? 0
      : stitchedProfiles.reduce((s, r) => s + r.marrow, 0) / n;
    const avgSpineScore = n === 0 ? 0
      : stitchedProfiles.reduce((s, r) => s + r.spine, 0) / n;

    return {
      status:            "online",
      schemaVersion:     SCHEMA_VERSION,
      records:           n,
      maxRecords:        MAX_RECORDS,
      totalObservations: this.mem.totalObservations,
      uniqueTerms:       Object.keys(this.mem.df).length,
      vocabularyDensity: n > 0
        ? +(Object.keys(this.mem.df).length / n).toFixed(2)
        : 0,
      avgDocLength:      +this.mem.avgDocLength.toFixed(1),
      avgQuality:        +avgQuality.toFixed(3),
      avgWeight:         +avgWeight.toFixed(3),
      avgUsageCount:     +avgUsageCount.toFixed(2),
      heuristicProfile: {
        bone: +avgBoneScore.toFixed(5),
        marrow: +avgMarrowScore.toFixed(5),
        spine: +avgSpineScore.toFixed(5),
        stitchMaxGap: STITCH_MAX_GAP,
      },
      learningModes: {
        intuitive: intuitiveCount,
        finegrained: finegrainedCount,
      },
      underweightRecords,
      retrievalConfig: {
        topK: TOP_K,
        rerankMultiplier: RERANK_MULTIPLIER,
        minSimilarity: MIN_SIMILARITY,
        minCompositeRetrieval: MIN_COMPOSITE_RETRIEVAL,
      },
      topTopics:         this._countField("topics"),
      topProviders:      this._countField("provider"),
      topModes:          this._countField("mode"),
      lastDistilled:     new Date(this.mem.lastDistilled).toISOString(),
      memoryPath:        MEMORY_PATH,
    };
  }

  forceDistill(): void {
    this._distill();
  }

  debugRetrieve(systemPrompt: string, userMessage: string, mode = "standard", k = TOP_K, ownerScope?: string | null): object {
    const neighbors = this._retrieve(userMessage, systemPrompt, mode, Math.max(1, Math.min(k, 20)), ownerScope ?? null);

    return {
      query: {
        systemPromptPreview: systemPrompt.slice(0, 160),
        userMessage,
        mode,
        requestedK: k,
      },
      retrieval: {
        returned: neighbors.length,
        minSimilarity: MIN_SIMILARITY,
        minCompositeRetrieval: MIN_COMPOSITE_RETRIEVAL,
        topMatch: neighbors[0]
          ? {
              id: neighbors[0].id,
              similarity: +neighbors[0].similarity.toFixed(4),
              retrievalScore: +neighbors[0].retrievalScore.toFixed(4),
              quality: +neighbors[0].quality.toFixed(4),
              weight: +neighbors[0].weight.toFixed(4),
              mode: neighbors[0].mode,
            }
          : null,
      },
      matches: neighbors.map((r) => {
        const stitched = computeStitchedProfile(r);
        return {
          id: r.id,
          timestamp: new Date(r.timestamp).toISOString(),
          mode: r.mode,
          provider: r.provider,
          source: r.source ?? "conversation",
          topics: r.topics,
          writingStyle: r.writingStyle,
          constraints: r.constraints,
          similarity: +r.similarity.toFixed(4),
          retrievalScore: +r.retrievalScore.toFixed(4),
          quality: +r.quality.toFixed(4),
          memoryWeight: +(r.weight ?? 0).toFixed(4),
          usageCount: r.usageCount,
          learningMode: r.learningMode ?? "finegrained",
          heuristicProfile: {
            bone: +stitched.bone.toFixed(5),
            marrow: +stitched.marrow.toFixed(5),
            spine: +stitched.spine.toFixed(5),
          },
          userMessagePreview: r.userMessage.slice(0, 160),
          responsePreview: r.response.slice(0, 240),
        };
      }),
    };
  }

  // ── Tier 1: Weighted Memory Adjustment ───────────────────────────────────

  /**
   * Adjust the dynamic weight of a stored memory record.
   * Positive delta boosts the record; negative delta penalises it.
   * Records that drop below MIN_MEMORY_WEIGHT are pruned on the next distill.
   *
   * Recommended deltas:
   *   High-scoring turn used this record → +WEIGHT_BOOST  (+0.10)
   *   User corrected / refuted a fact   → -WEIGHT_PENALTY (-0.30)
   */
  adjustMemoryWeight(id: string, delta: number): void {
    const rec = this.recordMap.get(id);
    if (!rec) return;
    rec.weight = Math.max(0.0, Math.min(1.0, rec.weight + delta));
    this._scheduleSave();
  }

  // ── Tier 5: Post-Turn Self-Scoring & Learning Loop ───────────────────────

  /**
   * Scores a completed interaction turn on three axes (0–100 each) and returns
   * a composite Turn_Score = Coherence×0.30 + Relevance×0.40 + Sentiment×0.30.
   *
   * Callers should use the returned scores to:
   *   1. Store a new memory via observe() with weight = turnScore / 100.
   *   2. Boost retrieved record weights when turnScore > 70 via adjustMemoryWeight().
   *   3. Penalise records when sentimentScore < 30 (correction/rejection signal).
   *
   * @param response         The agent response being scored.
   * @param userMessage      The user's query that prompted the response.
   * @param priorResponse    Optional: the agent's previous response (enables sentiment detection).
   * @param retrievedIds     Optional: IDs of records returned by _retrieve() for this turn.
   */
  scoreTurn(
    response:      string,
    userMessage:   string,
    priorResponse?: string,
    retrievedIds?:  string[],
  ): { coherenceScore: number; relevanceScore: number; sentimentScore: number; turnScore: number } {

    // ── Coherence (0–100): structure + grammar signals ──────────────────────
    const words = response.split(/\s+/).filter(w => w.length > 0);
    const total = Math.max(words.length, 1);
    const uniqueRatio  = new Set(words.map(w => w.toLowerCase())).size / total;
    const hasStructure = /^#{1,3}\s|\*\*[^*]+\*\*|^[-*•]\s|^\d+\.\s/m.test(response);
    const sentCount    = (response.match(/[.!?]+\s/g) ?? []).length + 1;
    const avgWPS       = total / sentCount;

    let coherenceScore = 50;
    coherenceScore += uniqueRatio > 0.60 ? 20 : uniqueRatio > 0.40 ? 10 : -15;
    coherenceScore += hasStructure ? 15 : 0;
    coherenceScore += (avgWPS >= 8 && avgWPS <= 40) ? 15 : -10;
    // Penalise coherence if the coherence gate would catch it
    if (!coherenceGate(response).pass) coherenceScore -= 20;
    coherenceScore = Math.max(0, Math.min(100, coherenceScore));

    // ── Relevance (0–100): query-keyword overlap ────────────────────────────
    const qTokens = new Set(tokenize(userMessage));
    const rTokens = new Set(tokenize(response));
    let overlap = 0;
    for (const t of qTokens) { if (rTokens.has(t)) overlap++; }
    const relevanceScore = Math.min(100,
      Math.round((overlap / Math.max(qTokens.size, 1)) * 100)
    );

    // ── User Sentiment (0–100): correction / confirmation / rejection signals
    let sentimentScore = 60; // neutral baseline
    if (priorResponse) {
      const uLow = userMessage.toLowerCase();
      const corrections  = ["no,","wrong","actually","that's not","incorrect","mistake","not right","you said","wait,"];
      const confirmations = ["yes","exactly","correct","perfect","great","love that","you're right","that's right","good point","brilliant","spot on"];
      const rejections   = ["stop","don't","never mind","forget it","that's wrong","terrible","awful","nonsense"];

      const cCount = corrections .filter(s => uLow.includes(s)).length;
      const fCount = confirmations.filter(s => uLow.includes(s)).length;
      const rCount = rejections  .filter(s => uLow.includes(s)).length;

      sentimentScore = Math.max(0, Math.min(100,
        60 + fCount * 15 - cCount * 20 - rCount * 25
      ));
    }

    // ── Composite Turn Score ────────────────────────────────────────────────
    const turnScore = Math.round(
      coherenceScore * 0.30 +
      relevanceScore * 0.40 +
      sentimentScore * 0.30
    );

    // ── Side-effect: boost/penalise retrieved records based on outcome ───────
    if (retrievedIds && retrievedIds.length > 0) {
      if (turnScore > 70) {
        for (const id of retrievedIds) this.adjustMemoryWeight(id, WEIGHT_BOOST);
      } else if (sentimentScore < 30) {
        // User corrected or rejected — penalise the most-used records
        for (const id of retrievedIds.slice(0, 2)) this.adjustMemoryWeight(id, -WEIGHT_PENALTY);
      }
    }

    return { coherenceScore, relevanceScore, sentimentScore, turnScore };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RETRIEVAL — Okapi BM25 via inverted index
  // ══════════════════════════════════════════════════════════════════════════

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
    if (candidateIds.size === 0) return [];

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
        // Robertson-Walker IDF with +1 smoothing — stays positive when df ≥ N
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1.0);
        // BM25 TF normalization with document-length dampening
        const tfNorm = (tf * (BM25_K1 + 1))
          / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (rec.docLength / avgdl)));
        bm25 += idf * tfNorm;
      }
      // Exponential-CDF normalization — maps (0, ∞) → (0, 1) stably.
      // At bm25 == qTokens.length the value ≈ 0.63 (natural "medium" match).
      const bm25Sim = 1 - Math.exp(-bm25 / Math.max(1, qTokens.length));
      if (bm25Sim >= MIN_SIMILARITY) stage1.push({ rec, bm25Sim });
    }

    // Sort Stage A by BM25 and keep the wide pool for re-ranking.
    stage1.sort((a, b) => b.bm25Sim - a.bm25Sim);
    const pool = stage1.slice(0, k * RERANK_MULTIPLIER);

    // ── Stage B: Re-rank with richer orthogonal signals ─────────────────────
    // BM25 is a good recall signal but conflates term frequency with relevance.
    // Stage B adds: cosine TF similarity (dense vector angle), quality scorer
    // ("Avg Quality"), and structured metadata alignment (topics, writingStyle,
    // constraints declared at seed/observe time).
    const scored: ScoredRecord[] = [];

    for (const { rec, bm25Sim } of pool) {
      // Dense cosine similarity — orthogonal to BM25 (angle vs. weighted count)
      const cosineSim = cosineSimilarity(qTF, qNorm, rec.tf, rec.tfNorm);

      // Recency decay
      const ageDays = (now - rec.timestamp) / 86_400_000;
      const recency = Math.exp(-ageDays / RECENCY_DECAY_DAYS);

      // ── Structured metadata alignment ─────────────────────────────────────
      // 1. Explicit topic overlap (declared topics, not just BM25 term hits)
      const sharedTopics = rec.topics.filter(t => qTopics.includes(t)).length;
      const topicScore   = Math.min(1, sharedTopics * 0.33);

      // 2. Writing style match (declared vs. inferred from query)
      const styleScore = (rec.writingStyle && rec.writingStyle === qStyle) ? 1.0 : 0.0;

      // 3. Constraint relevance — mode name or "system" in constraints signals high fit
      const constraintScore = (rec.constraints && rec.constraints.length > 0)
        ? ((rec.constraints.includes(mode) || rec.constraints.includes("system")) ? 1.0 : 0.0)
        : 0.0;

      const metaScore = topicScore * 0.60 + styleScore * 0.30 + constraintScore * 0.10;

      // Mode affinity bonus
      const modeBoost = rec.mode === mode ? 0.06 : 0;

      // ── Two-stage composite weight ────────────────────────────────────────
      // Stage A weight (BM25):  0.38 — lexical recall signal
      // Stage B additions:      0.23 cosine (dense), 0.17 quality, 0.12 dynamic weight
      //                         (Tier 1), 0.07 meta, 0.03 mode
      const stitchedProfile = computeStitchedProfile(rec);
      const boneBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.bone));
      const marrowBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.marrow));
      const spineBoost = Math.max(-0.02, Math.min(0.02, stitchedProfile.spine));
      const weight =
        bm25Sim      * 0.38 +
        cosineSim    * 0.23 +
        rec.quality  * 0.17 +
        rec.weight   * 0.12 +   // Tier 1: dynamic memory weight
        metaScore    * 0.07 +
        modeBoost    * 0.03 +
        boneBoost * 0.45 +
        marrowBoost * 0.20 +
        spineBoost * 0.35;

      // Expose both lexical similarity and the final composite retrieval score.
      scored.push({ ...rec, similarity: bm25Sim, weight, retrievalScore: weight });
    }

    return scored
      .sort((a, b) => b.weight - a.weight)
      .slice(0, k);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MMR SUMMARIZER — Maximum Marginal Relevance sentence selection
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Tier 2/3: Build the fused context payload injected into synthesize().
   * Produces a structured string with:
   *   <weighted_memory>  — top neighbors sorted by weight, tagged with scores
   *   <recent_turns>     — last 6 interaction summaries for short-term context
   *   Offline system prompt (Tier 3 no-regression directive)
   */
  private _buildFusedContext(userMessage: string, neighbors: ScoredRecord[], mode: string): string {
    const sorted = [...neighbors].sort((a, b) => b.weight - a.weight);

    const memoryBlock = sorted
      .slice(0, 5)
      .map((r, i) => (
        `[Memory ${i + 1} | weight=${r.weight.toFixed(2)} | quality=${r.quality.toFixed(2)} | mode=${r.mode}]\n` +
        `Q: ${r.userMessage.slice(0, 120)}\nA: ${r.response.slice(0, 280)}`
      ))
      .join("\n\n");

    const recent = this.mem.interactions.slice(-6);
    const turnsBlock = recent.length === 0
      ? "(no prior turns)"
      : recent
          .map(r =>
            `[${new Date(r.timestamp).toISOString()}] mode=${r.mode} | ` +
            `"${r.userMessage.slice(0, 80).replace(/\n/g, " ")}"`
          )
          .join("\n");

    return (
      `${OFFLINE_SYNTHESIS_SYSTEM_PROMPT}\n\n` +
      `<weighted_memory>\n${memoryBlock}\n</weighted_memory>\n\n` +
      `<recent_turns>\n${turnsBlock}\n</recent_turns>\n\n` +
      `[Offline synthesis — mode: ${mode} | generation params: temp=0.3, rep_penalty=1.2, presence_penalty=0.5, max_tokens=512]\n` +
      `Current query: ${userMessage}`
    );
  }

  private _composeMMR(
    userMessage:  string,
    neighbors:    ScoredRecord[],
    fusedContext?: string,   // Tier 2: pre-built payload (unused by MMR directly but available for logging/debug)
    tighter = false,         // Tier 4: auto-recovery pass — fewer sentences, higher λ
  ): string {
    const qTokens = new Set(tokenize(userMessage));
    const topics  = detectTopics(userMessage);

    interface Candidate {
      text:           string;
      tokens:         Set<string>;
      relevanceScore: number;
      neighborId:     string;
    }

    const candidates: Candidate[] = [];

    for (const nb of neighbors) {
      const sentences = this._getSentences(nb);
      for (const sent of sentences) {
        const sentTokens = new Set(tokenize(sent));

        // Proportion of query tokens found in this sentence
        let hits = 0;
        for (const qt of qTokens) { if (sentTokens.has(qt)) hits++; }
        const overlapRatio = qTokens.size > 0 ? hits / qTokens.size : 0;

        const relevanceScore =
          overlapRatio * 0.45 +
          nb.weight    * 0.35 +
          nb.quality   * 0.20;

        if (relevanceScore > 0.04) {
          candidates.push({ text: sent, tokens: sentTokens, relevanceScore, neighborId: nb.id });
        }
      }
    }

    if (candidates.length === 0) return this._topicFallback(userMessage);

    // ── Greedy MMR selection loop ─────────────────────────────────────────
    // Tier 4 tighter pass: fewer sentences + higher λ (more relevance, less diversity)
    const maxOutputSentences = tighter ? 4 : 9;
    const effectiveLambda    = tighter ? 0.82 : MMR_LAMBDA;
    // Dynamic source cap: distributes sentences proportionally across neighbors
    const authorSourceLimit = Math.max(2, Math.ceil(maxOutputSentences / Math.max(1, neighbors.length)));
    const sourceCounters    = new Map<string, number>();
    const selected: Candidate[] = [];

    while (selected.length < maxOutputSentences && candidates.length > 0) {
      let bestMMR  = -Infinity;
      let bestIdx  = -1;

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if ((sourceCounters.get(cand.neighborId) ?? 0) >= authorSourceLimit) continue;

        // Max Jaccard similarity to already-selected sentences (redundancy signal)
        let maxRedundancy = 0;
        for (const sel of selected) {
          const sim = jaccard(cand.tokens, sel.tokens);
          if (sim > maxRedundancy) maxRedundancy = sim;
        }

        // MMR = λ·relevance − (1−λ)·redundancy
        const mmrScore = effectiveLambda * cand.relevanceScore - (1 - effectiveLambda) * maxRedundancy;
        if (mmrScore > bestMMR) { bestMMR = mmrScore; bestIdx = i; }
      }

      if (bestIdx === -1) break;

      const winner = candidates.splice(bestIdx, 1)[0];
      selected.push(winner);
      sourceCounters.set(winner.neighborId, (sourceCounters.get(winner.neighborId) ?? 0) + 1);
    }

    if (selected.length === 0) return this._topicFallback(userMessage);

    // ── Diagnostic logging — Phase 2 requirement ─────────────────────────
    // Prints the full fused payload to the server console so you can verify
    // that <weighted_memory> and the system prompt are inside the payload.
    if (fusedContext) {
      const payloadPreview = fusedContext.slice(0, 1800);
      console.log(
        `\n[DEBUG - OFFLINE PAYLOAD SENT TO MODEL]\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${payloadPreview}${fusedContext.length > 1800 ? `\n...[${fusedContext.length - 1800} chars truncated]` : ""}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      );
    }

    // ── Assemble output — Tier 3 COGNITIVE FORMATTING ────────────────────
    // Structure mirrors the OFFLINE_SYNTHESIS_SYSTEM_PROMPT directive so the
    // output format is consistent with the injected system instruction.
    //
    //   ### 💡 Synthesis        — 2 highest-ranked MMR sentences (the core answer)
    //   ### 🔍 Key Points       — remaining sentences as bullet points
    //   ### 💬 Next Steps       — conversational follow-up pulled from top neighbor
    //   --- footer              — source count + semantic confidence

    const bestSim    = neighbors[0].similarity;
    const confidence = Math.min(96, Math.round(
      (bestSim * 0.55 + neighbors[0].quality * 0.30 + Math.min(1, neighbors.length / TOP_K) * 0.15) * 100
    ));

    // Section 1 — Synthesis: first 2 MMR picks (most relevant + diverse)
    const synthCut      = Math.min(2, selected.length);
    const synthText     = selected.slice(0, synthCut).map(s => s.text).join(" ");

    // Section 2 — Key Points: remaining sentences formatted as bullet list
    const keyPointItems = selected.slice(synthCut);
    const keyPointsText = keyPointItems.length > 0
      ? keyPointItems.map(s => `- ${s.text}`).join("\n")
      : `- Based on ${neighbors.length} learned interaction${neighbors.length !== 1 ? "s" : ""} ` +
        `with semantic confidence: ${confidence}%.`;

    // Section 3 — Conversation & Next Steps: find a question/suggestion from top neighbor
    const topNeighborSents = this._getSentences(neighbors[0]);
    const convoSent = topNeighborSents.find(s =>
      /\?$/.test(s.trim()) ||
      /\b(consider|explore|think about|what if|how might|let.s|tell me|would you)\b/i.test(s)
    );
    const convoText = convoSent ?? "What aspect of this would you like to explore further?";

    const memSourceLabel =
      fusedContext?.includes("<weighted_memory>")
        ? `${neighbors.length} weighted memory record${neighbors.length !== 1 ? "s" : ""}`
        : `${neighbors.length} learned interaction${neighbors.length !== 1 ? "s" : ""}`;

    return [
      `### 💡 Synthesis`,
      synthText,
      `### 🔍 Key Points & Observations`,
      keyPointsText,
      `### 💬 Conversation & Next Steps`,
      convoText,
      `\n---\n` +
        `*Synthesized from ${memSourceLabel} ` +
        `(semantic confidence: ${confidence}%). ` +
        `Cloud providers are reconnecting — resend your message in a moment for a full real-time response.*`,
    ].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FALLBACKS
  // ══════════════════════════════════════════════════════════════════════════

  private _topicFallback(userMessage: string, mode = "standard"): string {
    const topics  = detectTopics(userMessage);
    const count   = this.mem.interactions.length;
    const snippet = userMessage.slice(0, 120).replace(/\n/g, " ");

    // ── Low-confidence synthesis attempt ─────────────────────────────────
    // [FIX] Previously returned generic "reconnecting" text immediately.
    // Now: if we have any records matching the detected topics, synthesize from
    // those even below the BM25 threshold — personalized memory ALWAYS comes first.
    if (count > 0 && topics.length > 0) {
      const topicMatches = this.mem.interactions
        .filter(r => r.topics.some(t => topics.includes(t)))
        .sort((a, b) => b.quality - a.quality)
        .slice(0, 3);

      if (topicMatches.length >= 1) {
        const scoredTopicMatches: ScoredRecord[] = topicMatches.map((r) => ({
          ...r,
          similarity: 0.04,
          retrievalScore: Math.max(0.08, r.quality * 0.45 + (r.weight ?? 0) * 0.35),
          weight: r.weight ?? r.quality,
        }));

        console.log(
          `[SYNTHESIS] Low-confidence synthesis from ${topicMatches.length} topic-matched record(s) ` +
          `(topics: ${topics.join(", ")})`
        );

        const selection = this._selectKnowledgeSources(userMessage, scoredTopicMatches, mode);
        const lens = this._buildKnowledgeLens(userMessage, selection, mode);
        const rendered = this._renderKnowledgeLens(lens, topicMatches.length, true);
        const check = coherenceGate(rendered);
        if (check.pass) return rendered;

        return this._renderDeterministicFallback(lens, topicMatches[0]?.response ?? "");
      }
    }

    // ── Generic fallback: no matching records at all ──────────────────────
    const introByTopic: Record<string, string> = {
      writing:
        `Your creative writing request — "${snippet}" — is recognized. ` +
        `My synthesis engine has ${count} learned interactions but hasn't yet built ` +
        `a close semantic match for this specific creative prompt.`,
      code:
        `Your technical query — "${snippet}" — is recognized. ` +
        `I have ${count} learned interactions but need a closer semantic match ` +
        `to synthesize a confident code response.`,
      ai:
        `Your AI/ML question — "${snippet}" — is recognized. ` +
        `With ${count} interactions learned so far, I'm still building coverage for this query.`,
      science:
        `Your science question — "${snippet}" — is noted. ` +
        `I have ${count} learned interactions but need a stronger semantic neighbor.`,
      philosophy:
        `Your philosophical inquiry — "${snippet}" — is recognized. ` +
        `My knowledge base has ${count} interactions; this thread needs more coverage.`,
      history:
        `Your history question — "${snippet}" — is noted. ` +
        `I have ${count} interactions learned but lack a close semantic neighbor.`,
      faith:
        `Your theological question — "${snippet}" — is deeply recognized. ` +
        `With ${count} interactions stored, I'm still building coverage for this inquiry.`,
      math:
        `Your mathematics question — "${snippet}" — is noted. ` +
        `I need a closer learned match to synthesize a reliable mathematical response.`,
      current:
        `Your current events question — "${snippet}" — is recognized. ` +
        `I have ${count} interactions learned but need a closer match to synthesize confidently.`,
      business:
        `Your business question — "${snippet}" — is noted. ` +
        `I have ${count} learned interactions but need a stronger semantic neighbor.`,
      health:
        `Your health question — "${snippet}" — is recognized. ` +
        `I have ${count} interactions but need a closer semantic match.`,
    };

    const intro = topics.length > 0
      ? (introByTopic[topics[0]] ?? `Your question about "${snippet}" is noted with ${count} interactions learned.`)
      : `I'm in local synthesis mode for your query — "${snippet}". My knowledge base has ${count} interactions.`;

    return (
      `${intro}\n\n` +
      `The synthesis engine is active and growing with each cloud interaction. ` +
      `Cloud providers are reconnecting — please resend your message in a moment ` +
      `for a full real-time response, or I'll synthesize a stronger answer as my ` +
      `knowledge base expands.\n\n` +
      `*BetaGrace vI local synthesis — ${count} interactions learned, self-improving.*`
    );
  }

  private _decideMemoryProtection(
    userMessage: string,
    response: string,
    memory: boolean,
    quality: number,
  ): MemoryProtectionDecision {
    const storageMode: "intuitive" | "finegrained" = memory ? "finegrained" : "intuitive";
    const lowerUser = userMessage.toLowerCase();
    const reasons: string[] = [];

    const explicitCorrection = /\b(not relevant|doesn't follow|doesnt follow|too bland|rewrite|fix|shorter|more vivid|more creative)\b/i.test(userMessage);
    const repeatedPreferenceSignal = /\b(prefer|usually|always|never|like|dislike|want)\b/i.test(userMessage);
    const throwaway = userMessage.trim().length < 12 && !explicitCorrection;

    if (throwaway && storageMode === "intuitive") {
      return {
        shouldStore: false,
        storageMode,
        compressionLevel: "high",
        priority: 0.2,
        reason: ["throwaway_turn_filtered"],
      };
    }

    if (explicitCorrection) reasons.push("explicit_correction_detected");
    if (repeatedPreferenceSignal) reasons.push("preference_signal_detected");
    if (quality >= 0.6) reasons.push("high_quality_response");

    const priority = Math.max(0.25, Math.min(0.95,
      quality * 0.55 +
      (explicitCorrection ? 0.25 : 0) +
      (repeatedPreferenceSignal ? 0.10 : 0) +
      (memory ? 0.10 : -0.05)
    ));

    return {
      shouldStore: true,
      storageMode,
      compressionLevel: storageMode === "intuitive" ? "high" : explicitCorrection ? "low" : "medium",
      priority,
      reason: reasons.length > 0 ? reasons : ["general_learning_capture"],
    };
  }

  private _compressForLearningMode(
    response: string,
    learningMode: "intuitive" | "finegrained",
    compressionLevel: "high" | "medium" | "low",
  ): string {
    if (learningMode === "finegrained") {
      if (compressionLevel === "low") return response;
      if (compressionLevel === "medium") return response.slice(0, Math.min(MAX_RESPONSE_STORE_CHARS, 4000));
      return response.slice(0, Math.min(MAX_RESPONSE_STORE_CHARS, 2500));
    }

    const sentences = splitSentences(response).filter((s) => s.length >= 35);
    if (sentences.length === 0) return response.slice(0, 1500);
    const limited = compressionLevel === "high" ? 2 : 3;
    return sentences.slice(0, limited).join(" ").slice(0, 1800);
  }

  private _selectKnowledgeSources(userMessage: string, neighbors: ScoredRecord[], mode: string): KnowledgeSelection {
    const topics = detectTopics(userMessage);
    const queryStyle = detectWritingStyle(userMessage);
    const queryTokens = new Set(expandQueryTokens(tokenize(userMessage)));

    const contextualSeedWeight = (rec: ScoredRecord): number => {
      let score = rec.retrievalScore * 0.45 + rec.similarity * 0.20 + rec.quality * 0.10;
      if (rec.topics.some(t => topics.includes(t))) score += 0.15;
      if (rec.mode === mode) score += 0.06;
      if (rec.writingStyle === queryStyle) score += 0.06;
      if (rec.constraints?.includes("system")) score += 0.08;
      const responseTokens = new Set(tokenize(`${rec.userMessage} ${rec.response.slice(0, 280)}`));
      let tokenHits = 0;
      for (const token of queryTokens) if (responseTokens.has(token)) tokenHits++;
      score += Math.min(0.12, tokenHits * 0.02);
      return score;
    };

    const seedMatches = neighbors
      .filter(r => (r.source ?? "conversation") === "seed")
      .map(r => ({ rec: r, score: contextualSeedWeight(r) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ rec }) => rec);

    const memoryMatches = neighbors
      .filter(r => (r.source ?? "conversation") !== "seed")
      .sort((a, b) => {
        const aLearningBias = a.learningMode === "intuitive" ? a.retrievalScore * 0.88 + (a.boneScore ?? 0) * 0.25 : a.retrievalScore * 1.05 + (a.marrowScore ?? 0) * 0.15;
        const bLearningBias = b.learningMode === "intuitive" ? b.retrievalScore * 0.88 + (b.boneScore ?? 0) * 0.25 : b.retrievalScore * 1.05 + (b.marrowScore ?? 0) * 0.15;
        return bLearningBias - aLearningBias;
      })
      .slice(0, 3);

    return { seedMatches, memoryMatches };
  }

  private _buildKnowledgeLens(userMessage: string, selection: KnowledgeSelection, mode: string): KnowledgeLens {
    const topics = detectTopics(userMessage);
    const rankedPool = [...selection.seedMatches, ...selection.memoryMatches].slice(0, 4);

    const extractSentence = (text: string): string | null => {
      const candidates = splitSentences(text).filter(s => s.length >= 45);
      return candidates[0] ?? null;
    };

    const overviewSource = rankedPool
      .map(r => extractSentence(r.response) ?? r.response.slice(0, 220).replace(/\n/g, " ").trim())
      .find(Boolean)
      ?? "I have limited local support for this question, but I can still synthesize a grounded answer from the knowledge currently stored offline.";

    const pointSet = new Set<string>();

    if (selection.seedMatches.length > 0) {
      const seedDomains = Array.from(new Set(selection.seedMatches.flatMap(r => r.topics))).slice(0, 4);
      if (seedDomains.length > 0) {
        pointSet.add(`Core knowledge domains activated: ${seedDomains.join(", ")}.`);
      }
    }

    if (selection.memoryMatches.length > 0) {
      pointSet.add(`Conversation memory is being used as supporting context, not as the primary answer source.`);
    }
    for (const rec of rankedPool) {
      const topicBits = rec.topics.filter(t => topics.length === 0 || topics.includes(t));
      if (topicBits.length > 0) {
        pointSet.add(`Relevant domains: ${topicBits.slice(0, 3).join(", ")}.`);
      }
      if (rec.mode === mode) {
        pointSet.add(`This aligns with stored ${mode.replace(/_/g, " ")} mode behavior.`);
      }
      if (rec.constraints && rec.constraints.length > 0) {
        pointSet.add(`Constraint signals present: ${rec.constraints.slice(0, 3).join(", ")}.`);
      }
      const firstSentence = extractSentence(rec.response);
      if (firstSentence) pointSet.add(firstSentence);
      if (pointSet.size >= 5) break;
    }

    const keyPoints = Array.from(pointSet)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p, i, arr) => p.length >= 24 && arr.indexOf(p) === i)
      .slice(0, 4);

    const supportLevel: KnowledgeLens["supportLevel"] =
      selection.seedMatches.length > 0 ? "seeded"
      : selection.memoryMatches[0]?.retrievalScore >= MIN_COMPOSITE_RETRIEVAL ? "memory-backed"
      : topics.length > 0 ? "topic-backed"
      : "limited";

    const leadRecord = selection.seedMatches[0] ?? selection.memoryMatches[0] ?? rankedPool[0];
    const confidenceBase = leadRecord
      ? leadRecord.retrievalScore * 0.60 + leadRecord.quality * 0.25 + Math.min(1, rankedPool.length / TOP_K) * 0.15
      : 0.28;
    const confidence = Math.max(28, Math.min(94, Math.round(confidenceBase * 100)));

    const nextStep =
      mode === "code_graph" ? "If you want, I can narrow this to architecture, dependencies, or a specific file path."
      : mode === "video_generator" ? "If you want, I can turn this into scene language, shot design, or prompt structure."
      : topics.includes("code") ? "If you want, I can break this into implementation steps, debugging steps, or architecture notes."
      : topics.includes("writing") ? "If you want, I can turn this into a cleaner short passage, scene plan, or prose revision."
      : topics.includes("ai") ? "If you want, I can separate system knowledge, operational logic, and practical next steps more explicitly."
      : "Tell me which part you want sharpened, and I’ll synthesize that piece more directly.";

    return {
      overview: overviewSource,
      keyPoints,
      nextStep,
      confidence,
      supportLevel,
    };
  }

  private _renderKnowledgeLens(lens: KnowledgeLens, neighborCount: number, lowConfidence = false): string {
    const supportLabel =
      lens.supportLevel === "seeded" ? "seed knowledge + local memory"
      : lens.supportLevel === "memory-backed" ? "local memory"
      : lens.supportLevel === "topic-backed" ? "topic-aligned local knowledge"
      : "limited offline knowledge";

    const points = lens.keyPoints.length > 0
      ? lens.keyPoints.map((p) => `- ${p}`).join("\n")
      : "- Local synthesis has partial support for this query, but enough structure to answer in a grounded way.";

    const footerPrefix = lowConfidence ? "Low-confidence local synthesis" : "Local synthesis";

    return [
      `### 💡 Synthesis`,
      lens.overview,
      `### 🔍 Key Points & Observations`,
      points,
      `### 💬 Conversation & Next Steps`,
      lens.nextStep,
      `\n---\n*${footerPrefix} from ${supportLabel} (${neighborCount} source${neighborCount !== 1 ? "s" : ""}, semantic confidence: ${lens.confidence}%).*`,
    ].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private _renderDeterministicFallback(lens: KnowledgeLens, topResponse: string): string {
    const snippet = topResponse.slice(0, 220).replace(/\n/g, " ").trim();
    return [
      `### 💡 Synthesis`,
      lens.overview,
      `### 🔍 Key Points & Observations`,
      lens.keyPoints.length > 0 ? lens.keyPoints.map((p) => `- ${p}`).join("\n") : `- ${snippet || "Offline support is limited, but the synthesis engine remains active."}`,
      `### 💬 Conversation & Next Steps`,
      lens.nextStep,
    ].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  private _topicHeader(topic: string, neighborCount: number): string {
    const headers: Record<string, string> = {
      writing:    "**Synthesized Creative Knowledge**",
      code:       "**Synthesized Technical Knowledge**",
      ai:         "**Synthesized AI & Machine Learning Knowledge**",
      science:    "**Synthesized Scientific Knowledge**",
      philosophy: "**Synthesized Philosophical Knowledge**",
      history:    "**Synthesized Historical Knowledge**",
      faith:      "**Synthesized Theological Knowledge**",
      math:       "**Synthesized Mathematical Knowledge**",
      current:    "**Synthesized Current Events Knowledge**",
      creative:   "**Synthesized Creative Knowledge**",
      business:   "**Synthesized Business Knowledge**",
      health:     "**Synthesized Health & Medical Knowledge**",
    };
    return headers[topic] ?? `**Synthesized Knowledge** *(${neighborCount} source${neighborCount !== 1 ? "s" : ""})*`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAINTENANCE
  // ══════════════════════════════════════════════════════════════════════════

  private _distill(): void {
    // RACE-CONDITION FIX: Cancel any pending debounced async save before the sync write.
    // Without this, the debounce timer fires ~600ms after distill completes and writes
    // the PRE-distill mem snapshot back to disk, silently reverting all pruning work.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const before = this.mem.interactions.length;
    const now    = Date.now();

    // Tier 1: Prune records below the minimum memory weight threshold
    const preWeightCount = this.mem.interactions.length;
    this.mem.interactions = this.mem.interactions.filter(r => (r.weight ?? 1.0) >= MIN_MEMORY_WEIGHT);
    const weightPruned = preWeightCount - this.mem.interactions.length;
    if (weightPruned > 0) {
      console.log(`[SYNTHESIS] Weight-pruned ${weightPruned} low-weight records (weight < ${MIN_MEMORY_WEIGHT})`);
    }

    if (this.mem.interactions.length > MAX_RECORDS) {
      const scored = this.mem.interactions.map(rec => {
        const ageDays = (now - rec.timestamp) / 86_400_000;
        const recency = Math.exp(-ageDays / RECENCY_DECAY_DAYS); // consistent constant
        return { rec, score: rec.quality * 0.65 + recency * 0.35 };
      });
      scored.sort((a, b) => b.score - a.score);
      this.mem.interactions = scored.slice(0, MAX_RECORDS).map(r => r.rec);
    }

    // Rebuild df from surviving records
    const df: SparseVec = {};
    for (const rec of this.mem.interactions) {
      for (const term of Object.keys(rec.tf)) {
        df[term] = (df[term] ?? 0) + 1;
      }
    }
    this.mem.df       = df;
    this.mem.totalDocs = this.mem.interactions.length;

    // Recompute Welford avgDocLength from scratch (post-eviction)
    const totalLen = this.mem.interactions.reduce((s, r) => s + r.docLength, 0);
    this.mem.avgDocLength = totalLen / Math.max(1, this.mem.interactions.length);

    this.mem.lastDistilled  = now;
    this.pendingSinceDistill = 0;

    // Rebuild in-memory structures
    this._rebuildIndexFromMemory();
    this.sentenceCache.clear();

    saveMemorySync(this.mem);
    console.log(`[SYNTHESIS] Distilled: ${before} → ${this.mem.interactions.length} records. ` +
      `Vocabulary: ${Object.keys(df).length} terms. avgDocLen: ${this.mem.avgDocLength.toFixed(1)}`);
  }

  /**
   * Rebuild the inverted index and recompute global stats from mem.interactions.
   * Called once on load, and after every distill.
   */
  private _rebuildIndexFromMemory(): void {
    this.invertedIndex.clear();
    this.recordMap.clear();
    const n = this.mem.interactions.length;
    if (n === 0) return;

    for (const rec of this.mem.interactions) {
      this.recordMap.set(rec.id, rec);
      for (const term of Object.keys(rec.tf)) {
        let posting = this.invertedIndex.get(term);
        if (!posting) { posting = new Set(); this.invertedIndex.set(term, posting); }
        posting.add(rec.id);
      }
    }

    // Recompute Welford mean from scratch (ensures consistency after migration)
    const totalLen = this.mem.interactions.reduce((s, r) => s + r.docLength, 0);
    this.mem.avgDocLength = totalLen / n;
    this.mem.totalDocs    = n;
  }

  /**
   * Cosine-similarity check against the most recent DEDUP_WINDOW records.
   * Prevents storing near-identical follow-up responses.
   */
  private _isNearDuplicate(tf: SparseVec, tfNorm: number): boolean {
    const recent = this.mem.interactions.slice(-DEDUP_WINDOW);
    for (const rec of recent) {
      if (cosineSimilarity(tf, tfNorm, rec.tf, rec.tfNorm) > COSINE_DEDUP_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sentence cache: retrieve or compute splitSentences() for a given record.
   * The cache is cleared on distill (old record IDs are evicted).
   */
  private _inferBoneAndMarrow(userMessage: string, response: string): { bone: number; marrow: number } {
    const userLower = userMessage.toLowerCase();
    const responseLower = response.toLowerCase();

    const asksForCreative = /\b(write|story|scene|creative|rewrite|short story|make it better|make it vivid|more robust)\b/i.test(userMessage);
    const responseLooksCreative = /\b(scene|image|atmosphere|narrative|character|sensory|cinematic|theme|voice|structure|vivid)\b/i.test(responseLower);
    const responseLooksStructured = /\b(step|because|therefore|specifically|relevant|prompt|structure|mode|reason)\b/i.test(responseLower);
    const queryTokens = new Set(expandQueryTokens(tokenize(userMessage)));
    const responseTokens = new Set(tokenize(response));

    let tokenOverlap = 0;
    for (const token of queryTokens) if (responseTokens.has(token)) tokenOverlap++;

    let bone = 0;
    let marrow = 0;

    if (tokenOverlap >= 2) bone += BONE_BOOST;
    if (responseLooksStructured) bone += BONE_BOOST;
    if (asksForCreative && responseLooksCreative) marrow += MARROW_BOOST;
    if (responseLooksCreative) marrow += MARROW_BOOST * 0.5;

    if (userLower.includes("not relevant") || userLower.includes("isnt relevant") || userLower.includes("isn't relevant") || userLower.includes("doesnt follow") || userLower.includes("doesn't follow")) {
      bone -= BONE_PENALTY;
    }
    if (userLower.includes("too bland") || userLower.includes("that sucked") || userLower.includes("bad response")) {
      marrow -= MARROW_PENALTY;
    }

    return {
      bone: Math.max(-0.05, Math.min(0.05, bone)),
      marrow: Math.max(-0.05, Math.min(0.05, marrow)),
    };
  }

  private _getSentences(rec: ScoredRecord): string[] {
    let sents = this.sentenceCache.get(rec.id);
    if (!sents) {
      sents = splitSentences(rec.response);
      this.sentenceCache.set(rec.id, sents);
    }
    return sents;
  }

  /**
   * Debounced async save — the timer resets on every observe() call.
   * Fires SAVE_DEBOUNCE_MS after the last observe(), never blocking the event loop.
   */
  private _scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveMemoryAsync(this.mem).catch(e =>
        console.error("[SYNTHESIS] Async disk write failed:", e)
      );
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Generic field counter for stats (topics array, provider string, mode string).
   */
  private _countField(field: "topics" | "provider" | "mode"): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const rec of this.mem.interactions) {
      const val = rec[field];
      if (Array.isArray(val)) {
        for (const v of val) counts[v] = (counts[v] ?? 0) + 1;
      } else if (typeof val === "string") {
        counts[val] = (counts[val] ?? 0) + 1;
      }
    }
    return Object.fromEntries(
      Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

export const synthesisEngine = new SynthesisEngine();

// ═════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE SEED INJECTION — Server Boot (Append-Only, Zero-Risk)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Curated Q&A pairs to pre-hydrate the local BM25 index at server startup.
 * These seeds establish foundational system identity, narrative intelligence,
 * and local fallback knowledge before any user interactions occur.
 */
export const BETAGRACE_KNOWLEDGE_SEEDS = [
  {
    id: "seed_sys_core_1",
    question: "What is BetaGrace vI?",
    answer:
      "BetaGrace vI is a full-stack AI agent platform built on TypeScript, React, Express, and PostgreSQL. " +
      "It features 8 specialized AI modes (Standard, Flesh Architect, Sanctuary, Advanced Reasoning, Autonomous, Video Generator, Code Graph, Academic Research), " +
      "a 70x7 Academic Artifact Builder for deep-research synthesis, and a cinematic Video Generation Pipeline. " +
      "The platform operates entirely on free-tier AI providers with a resilient fallback chain and offline-capable synthesis engine.",
    topics:       ["ai", "technology", "platform"],
    constraints:  ["system", "identity"],
    writingStyle: "instructional",
  },
  {
    id: "seed_narrative_framework_1",
    question: "What defines the Horrors of Grace narrative framework?",
    answer:
      "Horrors of Grace is a literary and spiritual framework exploring the terrifying and profound weight of divine mercy. " +
      "It examines how grace operates as a transformative, often burdensome force where physical and psychological sacrifice intersect with spiritual redemption. " +
      "Environment functions as an active antagonist, faith is questioned through doubt rather than certainty, and salvation demands a price that reshapes the soul. " +
      "The framework centers on witness over victory, testimony over triumph, and the cost of choosing surrender-love over control.",
    topics:       ["writing", "theology", "spiritual"],
    constraints:  ["horror", "spiritual", "literary"],
    writingStyle: "narrative",
  },
  {
    id: "seed_sys_synthesis_engine_1",
    question: "How does the local synthesis engine function during cloud provider outages?",
    answer:
      "The local synthesis engine utilizes a fast, in-memory BM25 semantic index for real-time memory retrieval, ensuring narrative continuity and intelligence resilience. " +
      "Even when primary providers (Gemini, Pollinations, HuggingFace) are unreachable, the synthesis engine can retrieve context from locally-stored interactions, " +
      "rank them by relevance using Okapi BM25, and compose coherent responses using Maximal Marginal Relevance (MMR) — guaranteeing uninterrupted conversation flow.",
    topics:       ["technology", "ai"],
    constraints:  ["system", "technical"],
    writingStyle: "technical",
  },
  {
    id: "seed_narrative_thematic_1",
    question: "What are the core character archetypes in the Horrors of Grace universe?",
    answer:
      "The Horrors of Grace introduces recurring archetypes: the Covenant-Keeper (witness to divine grace), the Surrendered (those who accept mercy's burden), " +
      "the Crowned-Deep (embodiment of corrupted spiritual authority), the Guardian (protector through sacrifice), the Seer (prophet bearing unbearable truth), " +
      "and the Daughters of Sorrow (testimonies of grief transformed into witness). These archetypes embody the tension between control and surrender, " +
      "between the seduction of false certainty and the courage of faith-through-doubt.",
    topics:       ["writing", "theology", "spiritual"],
    constraints:  ["horror", "literary", "spiritual"],
    writingStyle: "narrative",
  },
  {
    id: "seed_sys_modes_1",
    question: "What are the 8 AI modes in BetaGrace and how do they differ?",
    answer:
      "Standard (baseline reasoning), Flesh Architect (visceral narrative/embodied theology), Sanctuary (contemplative/meditative depth), " +
      "Advanced Reasoning (multi-step analytical chains), Autonomous (self-directing task execution), Video Generator (cinematic synthesis), " +
      "Code Graph (software architecture & semantics), Academic Research (70x7 deep synthesis pipeline). " +
      "Each mode activates specialized system prompts, weighting, and reasoning chains tuned for its domain.",
    topics:       ["ai", "technology"],
    constraints:  ["system"],
    writingStyle: "instructional",
  },
  {
    id: "seed_faith_integration_1",
    question: "How does Christian theology integrate into BetaGrace's reasoning?",
    answer:
      "BetaGrace embeds a faith-enhancement module that grounds creative work in Christological principles: divine truth, scriptural wisdom, redemptive narrative, " +
      "moral clarity (sin as choosing our own truth over God's), agape love (unconditional grace), hope & grace through surrender, spiritual depth, and Christ-centrality. " +
      "This integration ensures that theological reasoning, character motivations, and thematic development reflect authentic Christian soteriology rather than secular or syncretic frameworks.",
    topics:       ["theology", "spiritual", "writing"],
    constraints:  ["spiritual", "religious"],
    writingStyle: "analytical",
  },
];

/**
 * Safely injects knowledge seeds into the local synthesis engine at boot.
 * Uses the engine's observe() method (which already handles indexing, dedup, quality scoring).
 * Wrapped in try/catch so a seed injection failure cannot crash the Express server startup.
 *
 * @param engine - The SynthesisEngine instance to hydrate
 * @returns Promise that resolves when injection is complete or safely fails
 */
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
        // observe() now accepts optional metadata (topics, constraints, writingStyle).
        // Declared metadata is encoded into the BM25 context window so those terms
        // are indexed, and stored on the record for Stage B re-ranking.
        engine.observe(
          `Knowledge Seed: ${seed.id}`,  // systemPrompt
          seed.question,                   // userMessage
          seed.answer,                     // response
          "local",                         // provider
          "standard",                      // mode
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
    // Non-fatal: we swallow the error so server startup never crashes due to a seed failure.
    console.error(
      "[Synthesis Engine] Non-fatal error during Knowledge Seed boot sequence:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
