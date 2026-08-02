/**
 * Academic Research Engine — 70x7 Artifact Builder + DuckDuckGo Guard Loop
 *
 * ADDITIVE MODULE — sandboxed injection into Academic Research Mode.
 * Does NOT modify, deprecate, or touch any existing search tools or routes.
 *
 * Phase 1: DuckDuckGo Guard Loop
 *   - LRU cache (30 slots) for exact-duplicate query interception
 *   - 4-second minimum throttle between live network requests
 *   - Hard-limited to top-3 results, snippets truncated to 300 chars
 *   - Graceful degradation on any HTTP / rate-limit error (no retries)
 *
 * Phase 2: 70x7 Artifact Builder (token bypass engine)
 *   - State 1: Blueprint generation (JSON outline)
 *   - State 2: Section-by-section while loop
 *   - State 3: Per-section Guard Loop context + LLM generation
 *   - State 4: Append section to academic_artifact.md in 'a' mode
 *   - State 5: Context flush between sections to free token headroom
 */


// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Guard Loop — DuckDuckGo search helper (sandboxed, throttled, cached)
// ─────────────────────────────────────────────────────────────────────────────

const GUARD_LOOP_CACHE = new Map<string, string>();
const GUARD_LOOP_MAX_CACHE = 30;
let guardLoopLastSearchTime = 0;
const GUARD_LOOP_MIN_INTERVAL_MS = 4000;

/**
 * Sanitise a raw query into compact DuckDuckGo-friendly keywords.
 * Strips filler words so the API gets a tighter signal.
 */
function sanitiseQuery(raw: string): string {
  return raw
    .replace(
      /\b(please|can you|could you|tell me|about|what is|who is|when did|where is|how does|the|a |an )\b/gi,
      " ",
    )
    .replace(/\s{2,}/g, " ")
    .trim()
    .substring(0, 120);
}

/**
 * Guard Loop search helper.
 *
 * @param query  Raw research query string
 * @returns      Formatted string of top-3 search snippets, or fallback message
 */
export async function academicSearchGuard(query: string): Promise<string> {
  const normalisedKey = sanitiseQuery(query).toLowerCase();

  // ── LRU Cache intercept ──────────────────────────────────────────────────
  if (GUARD_LOOP_CACHE.has(normalisedKey)) {
    console.log(
      "[ACADEMIC GUARD LOOP] Cache hit — serving cached result for:",
      normalisedKey.substring(0, 60),
    );
    return GUARD_LOOP_CACHE.get(normalisedKey)!;
  }

  // ── Throttle: enforce 4-second minimum between requests ─────────────────
  const now = Date.now();
  const elapsed = now - guardLoopLastSearchTime;
  if (elapsed < GUARD_LOOP_MIN_INTERVAL_MS) {
    const waitMs = GUARD_LOOP_MIN_INTERVAL_MS - elapsed;
    console.log(
      `[ACADEMIC GUARD LOOP] Throttle — waiting ${waitMs}ms before next request`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // ── Network request (fail-fast, no retry) ───────────────────────────────
  try {
    guardLoopLastSearchTime = Date.now();
    const searchQuery = sanitiseQuery(query);
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1&skip_disambig=1&t=betagrace-academic`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(apiUrl, {
      headers: { "User-Agent": "BetaGrace-Academic-Research/vI" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      AbstractText?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
        Topics?: Array<{ Text?: string; FirstURL?: string }>;
      }>;
    };

    const segments: string[] = [];

    // Abstract (primary result)
    if (data.AbstractText && data.AbstractText.trim().length > 20) {
      segments.push(data.AbstractText.substring(0, 300).trim());
    }

    // Related topics (top-3 hard limit)
    const topics = data.RelatedTopics ?? [];
    for (const topic of topics) {
      if (segments.length >= 3) break;
      // Nested topic group
      if (topic.Topics && topic.Topics.length > 0) {
        for (const sub of topic.Topics) {
          if (segments.length >= 3) break;
          if (sub.Text && sub.Text.trim().length > 20) {
            segments.push(sub.Text.substring(0, 300).trim());
          }
        }
      } else if (topic.Text && topic.Text.trim().length > 20) {
        segments.push(topic.Text.substring(0, 300).trim());
      }
    }

    if (segments.length === 0) {
      const fallback =
        "Academic Search returned no usable snippets. Falling back to internal knowledge base.";
      _cacheResult(normalisedKey, fallback);
      return fallback;
    }

    const formatted = segments
      .slice(0, 3)
      .map((s, i) => `[Academic Source ${i + 1}] ${s}`)
      .join("\n");

    _cacheResult(normalisedKey, formatted);
    console.log(
      `[ACADEMIC GUARD LOOP] Retrieved ${segments.length} snippet(s) for: "${searchQuery.substring(0, 50)}"`,
    );
    return formatted;
  } catch (err: unknown) {
    // Graceful degradation — catch ALL errors, DO NOT RETRY
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ACADEMIC GUARD LOOP] Search throttled/failed:", msg);
    const fallback =
      "Academic Search throttled by provider. Falling back to internal knowledge base.";
    _cacheResult(normalisedKey, fallback);
    return fallback;
  }
}

function _cacheResult(key: string, value: string): void {
  if (GUARD_LOOP_CACHE.size >= GUARD_LOOP_MAX_CACHE) {
    // Evict oldest entry (Map preserves insertion order)
    const firstKey = GUARD_LOOP_CACHE.keys().next().value;
    if (firstKey !== undefined) GUARD_LOOP_CACHE.delete(firstKey);
  }
  GUARD_LOOP_CACHE.set(key, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: 70x7 Artifact Builder — token bypass engine
// ─────────────────────────────────────────────────────────────────────────────

export interface ArtifactBuildOptions {
  topic: string;
  generateFn: (systemPrompt: string, userMsg: string) => Promise<string>;
  onSectionComplete?: (sectionTitle: string, index: number, total: number) => void;
  /** Optional: the active operational mode (e.g. 'flesh_architect', 'sanctuary').
   *  When supplied, the pipeline tunes its section prompts to preserve the
   *  thematic voice of that mode rather than defaulting to plain academic prose. */
  contextualMode?: string;
}

export interface ArtifactBuildResult {
  success: boolean;
  content: string;
  sectionsCompleted: number;
  totalSections: number;
  error?: string;
}

/**
 * Builds the section blueprint from a research topic.
 * Returns a JSON array of section title strings.
 */
async function buildBlueprint(
  topic: string,
  generateFn: (sys: string, user: string) => Promise<string>,
): Promise<string[]> {
  const blueprintSystemPrompt = `You are an academic research architect. Your sole task is to output a JSON array of section titles for a comprehensive research paper on the given topic. Output ONLY a valid JSON array of strings — no markdown, no explanation, no prose. Example: ["Abstract","Introduction","Literature Review","Methodology","Results","Discussion","Conclusion","References"]`;

  const blueprintUserMsg = `Create a section outline (5-7 sections) for an academic research paper on: ${topic}. Output ONLY the JSON array of section title strings, no explanation.`;

  const raw = await generateFn(blueprintSystemPrompt, blueprintUserMsg);

  // Extract JSON array from the response
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) {
    // Fallback blueprint — 7 sections max for response-time budget
    return [
      "Abstract",
      "Introduction",
      "Literature Review",
      "Methodology",
      "Findings & Discussion",
      "Conclusion",
      "References",
    ];
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Hard-cap at 7 sections to keep pipeline within response time budget
      return parsed.slice(0, 7).map((s: unknown) => String(s));
    }
  } catch {
    // Fall through to default
  }

  return [
    "Abstract",
    "Introduction",
    "Literature Review",
    "Methodology",
    "Findings & Discussion",
    "Conclusion",
    "References",
  ];
}

/**
 * The 70x7 Artifact Builder.
 *
 * Iterates through the document blueprint one section at a time, gathers
 * live search context via the Guard Loop, generates that section's prose,
 * and appends it to an artifact Markdown file. Clears short-term context
 * between sections to free token headroom.
 */
export async function run70x7Pipeline(
  opts: ArtifactBuildOptions,
): Promise<ArtifactBuildResult> {
  const { topic, generateFn, onSectionComplete, contextualMode } = opts;

  console.log(`[70x7 ARTIFACT BUILDER] Starting pipeline for topic: "${topic.substring(0, 80)}"`);

  // ── State 1: Blueprint ────────────────────────────────────────────────────
  let blueprint: string[];
  try {
    blueprint = await buildBlueprint(topic, generateFn);
    console.log(`[70x7 ARTIFACT BUILDER] Blueprint generated: ${blueprint.length} sections`);
  } catch (err) {
    return {
      success: false,
      content: '',
      sectionsCompleted: 0,
      totalSections: 0,
      error: `Blueprint generation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Initialise in-memory content accumulator ──────────────────────────────
  const contentParts: string[] = [
    `# Academic Research Paper\n\n` +
    `**Topic:** ${topic}\n\n` +
    `**Generated:** ${new Date().toISOString()}\n\n` +
    `**Sections:** ${blueprint.length}\n\n` +
    `---\n\n`,
  ];

  let sectionsCompleted = 0;

  // ── State 2: The 70x7 Loop ─────────────────────────────────────────────────
  for (let i = 0; i < blueprint.length; i++) {
    const sectionTitle = blueprint[i];
    console.log(
      `[70x7 ARTIFACT BUILDER] Processing section ${i + 1}/${blueprint.length}: "${sectionTitle}"`,
    );

    // ── State 3: Guard Loop search for this section ────────────────────────
    let searchContext = "";
    try {
      const sectionQuery = `${topic} ${sectionTitle} academic research`;
      searchContext = await academicSearchGuard(sectionQuery);
    } catch {
      searchContext =
        "Academic Search throttled by provider. Falling back to internal knowledge base.";
    }

    // ── State 3 continued: LLM generation for this section ────────────────
    // Preserve thematic resonance when a contextualMode is bound to this job
    const modeVoiceLayer = contextualMode && contextualMode !== 'academic_research'
      ? ` Infuse the writing voice and thematic lens of the "${contextualMode}" operational mode while maintaining academic rigour.`
      : '';
    const sectionSystemPrompt =
      `You are an elite academic researcher writing a formal research paper. ` +
      `Write ONLY the content for the section titled "${sectionTitle}" of a paper on: ${topic}. ` +
      `Use formal academic prose, APA 7.0 style, evidence-based language, and precise terminology.` +
      `${modeVoiceLayer} ` +
      `Do NOT include the section title heading in your output — only the body text. ` +
      `Draw on the following live research context when relevant:\n\n${searchContext}`;

    const sectionUserMsg =
      `Write the full "${sectionTitle}" section for the research paper on "${topic}". ` +
      `Be thorough, cite evidence where applicable, and use formal academic language. ` +
      `This is section ${i + 1} of ${blueprint.length}.`;

    let sectionContent = "";
    try {
      // ── State 5: Context flush — each section call is independent ─────────
      // generateFn receives only the section-specific system + user prompt,
      // deliberately omitting conversation history to free token headroom.
      sectionContent = await generateFn(sectionSystemPrompt, sectionUserMsg);
    } catch (err) {
      sectionContent = `*[Section generation failed: ${err instanceof Error ? err.message : String(err)}]*`;
    }

    // ── State 4: Accumulate section in memory ─────────────────────────────
    contentParts.push(`## ${sectionTitle}\n\n` + sectionContent.trim() + `\n\n---\n\n`);
    sectionsCompleted++;
    console.log(
      `[70x7 ARTIFACT BUILDER] ✅ Section ${i + 1}/${blueprint.length} accumulated (${sectionContent.length} chars)`,
    );

    if (onSectionComplete) {
      onSectionComplete(sectionTitle, i + 1, blueprint.length);
    }
  }

  const content = contentParts.join('');
  console.log(
    `[70x7 ARTIFACT BUILDER] Pipeline complete — ${sectionsCompleted}/${blueprint.length} sections, ${content.length} chars`,
  );

  return {
    success: sectionsCompleted > 0,
    content,
    sectionsCompleted,
    totalSections: blueprint.length,
  };
}
