// Candidate knowledge seed extensions — non-destructive
// Each seed now carries structured metadata (topics, constraints, writingStyle)
// for Stage B re-ranking in the two-stage BM25 retrieval pipeline.

export const BETAGRACE_KNOWLEDGE_SEED_EXTENSIONS = [
  {
    id: "seed_flesh_architect_1",
    question: "What is the Flesh Architect mode and when should it be used?",
    answer:
      "Flesh Architect focuses on embodied, sensory-first narrative: physical sensation, consent dynamics, and ethical portrayal of intimacy. Use it for character-driven scenes requiring tactile specificity and psychological realism while maintaining safety and respect.",
    topics:       ["writing", "creative"],
    constraints:  ["explicit_ok", "embodied", "literary"],
    writingStyle: "narrative",
  },

  {
    id: "seed_advanced_reasoning_1",
    question: "How should Advanced Reasoning approach complex, multi-step problems?",
    answer:
      "Decompose into first principles, audit assumptions, apply Bayesian updates, steel-man opposing views, and verify intermediate outputs with tests or small proofs before composing the final answer.",
    topics:       ["reasoning", "analytical"],
    constraints:  ["analytical", "structured"],
    writingStyle: "analytical",
  },

  {
    id: "seed_autonomous_agent_1",
    question: "What are safe design patterns for autonomous agents?",
    answer:
      "Design with explicit goal specs, capability lists, human-in-loop checkpoints, idempotent actions, robust logging, and rollback strategies. Validate on sandboxed data and require explicit approval for destructive operations.",
    topics:       ["ai", "technology"],
    constraints:  ["technical", "safety"],
    writingStyle: "technical",
  },

  {
    id: "seed_video_generator_1",
    question: "What guidelines produce cinematic visual concepts for the video pipeline?",
    answer:
      "Map narrative beats to shot scale and movement, define color palettes and motif assets, and provide a shot list with emotional intent and transition notes to guide the renderer.",
    topics:       ["creative", "visual", "cinematic"],
    constraints:  ["visual", "cinematic"],
    writingStyle: "instructional",
  },

  {
    id: "seed_code_graph_1",
    question: "How do you perform a code-graph analysis to find hotspots?",
    answer:
      "Compute node centrality, measure cyclomatic complexity, identify high fan-in modules, and flag modules with dense coupling for refactoring. Prioritize tests and API contracts around high-risk nodes.",
    topics:       ["technology", "programming"],
    constraints:  ["technical"],
    writingStyle: "technical",
  },

  {
    id: "seed_academic_research_1",
    question: "What does the Academic Research synthesis include?",
    answer:
      "Literature mapping, citation formatting, methodology selection, statistical guidance, result interpretation, reproducibility checks, and a staged drafting + peer-review simulation (70x7 model).",
    topics:       ["research", "academic"],
    constraints:  ["academic", "scholarly"],
    writingStyle: "academic",
  },

  {
    id: "seed_mathematics_1",
    question: "What math topics should local synthesis support?",
    answer:
      "Provide calculus, linear algebra, discrete math, probability, statistics, and formal proof sketches with worked examples and recommended verification strategies.",
    topics:       ["mathematics", "science"],
    constraints:  ["academic", "technical"],
    writingStyle: "instructional",
  },

  {
    id: "seed_music_1",
    question: "How should music synthesis propose arrangements?",
    answer:
      "Suggest harmonic progressions, rhythmic patterns, instrumentation, motif development, and mixing/production guidelines tailored to the intended emotional arc and genre.",
    topics:       ["creative", "music"],
    constraints:  ["artistic"],
    writingStyle: "instructional",
  },

  {
    id: "seed_cinema_1",
    question: "What are quick rules for visual storytelling and continuity?",
    answer:
      "Use shot scale to convey narrative scope, maintain spatial continuity unless intentionally breaking it, and design edits to support emotional transitions (match on action, sound bridges).",
    topics:       ["creative", "cinematic", "visual"],
    constraints:  ["artistic", "cinematic"],
    writingStyle: "instructional",
  },

  {
    id: "seed_legal_1",
    question: "What legal cautions should automated content generation include?",
    answer:
      "Flag IP risks, identify jurisdictional constraints, recommend licensing checks, and include disclaimers. For contract or legal decisions, always direct users to licensed counsel.",
    topics:       ["legal"],
    constraints:  ["compliance", "cautionary"],
    writingStyle: "analytical",
  },

  {
    id: "seed_health_1",
    question: "How to present medical or health information responsibly?",
    answer:
      "Provide evidence-based summaries, include citations, clearly flag uncertainty, and recommend consultation with qualified health professionals for personal medical advice.",
    topics:       ["health", "science"],
    constraints:  ["medical", "cautionary"],
    writingStyle: "instructional",
  },

  {
    id: "seed_business_1",
    question: "Which business frameworks help evaluate early-stage product-market fit?",
    answer:
      "Combine qualitative interviews (JTBD), retention cohorts, unit-economics (LTV/CAC), pricing experiments, and funnel metrics to validate hypotheses quickly.",
    topics:       ["business"],
    constraints:  ["analytical"],
    writingStyle: "analytical",
  },

  {
    id: "seed_ai_technology_1",
    question: "How does BetaGrace summarize the AI/Model landscape?",
    answer:
      "Summarize foundation models, agent stacks, multimodal pipelines, and trade-offs (latency, cost, inference constraints). Recommend toolchains for prototyping vs. production.",
    topics:       ["ai", "technology"],
    constraints:  ["technical"],
    writingStyle: "instructional",
  },

  {
    id: "seed_science_1",
    question: "What principles guide scientific synthesis in the local engine?",
    answer:
      "Cite primary studies, note effect sizes and limitations, discuss reproducibility, and avoid overgeneralizing from single studies.",
    topics:       ["science"],
    constraints:  ["academic", "scholarly"],
    writingStyle: "instructional",
  },

  {
    id: "seed_current_events_1",
    question: "How should the system handle time-sensitive facts?",
    answer:
      "Timestamp claims, differentiate verified reports from analysis, and provide source references; recommend re-checks for time-sensitive assertions.",
    topics:       ["news", "current_events"],
    constraints:  ["temporal", "cautionary"],
    writingStyle: "analytical",
  },

  {
    id: "seed_programming_1",
    question: "What programming & engineering guidance should local synthesis include?",
    answer:
      "Cover idiomatic JS/TS, Python, architecture patterns, testing strategies, and common debugging heuristics; prefer minimal reproducible examples.",
    topics:       ["programming", "technology"],
    constraints:  ["technical"],
    writingStyle: "technical",
  },

  {
    id: "seed_philosophy_1",
    question: "When to use philosophical framing in narrative or ethics?",
    answer:
      "Use ethical frameworks (virtue, deontology, consequentialism) to clarify trade-offs, and connect metaphysical claims to character motivations with humility about contested positions.",
    topics:       ["philosophy", "ethics"],
    constraints:  ["analytical", "philosophical"],
    writingStyle: "analytical",
  },

  {
    id: "seed_architecture_1",
    question: "What architecture principles does the codebase follow?",
    answer:
      "Favor modularity, observability, graceful degradation, idempotency, and clear separation of concerns between modes and storage layers.",
    topics:       ["technology", "architecture"],
    constraints:  ["technical"],
    writingStyle: "technical",
  },

  {
    id: "seed_history_1",
    question: "How should historical context be used in synthesis?",
    answer:
      "Provide timeline anchoring, cite primary sources where possible, avoid presentism, and draw cautious analogies to support interpretation.",
    topics:       ["history"],
    constraints:  ["academic", "cautionary"],
    writingStyle: "analytical",
  },

  {
    id: "seed_biops_1",
    question: "What is the bi-ops layer inside local synthesis?",
    answer:
      "Bi-ops is a bidirectional operations layer for local reasoning: it reads the user's immediate prompt while also checking BetaGrace's internal knowledge priorities, then balances those two directions before composing an answer. Its role is to stop local fallback from parroting isolated memories and instead produce a response that is context-aware, system-aware, and grounded in the right knowledge band.",
    topics:       ["ai", "technology", "architecture"],
    constraints:  ["system", "technical", "reasoning"],
    writingStyle: "technical",
  },

  {
    id: "seed_triage_1",
    question: "How should triage work in the local synthesis engine?",
    answer:
      "Triage should classify a prompt before answering: determine whether it is asking for system explanation, creative generation, technical guidance, analytical reasoning, or recall of prior context. Then route emphasis accordingly — core knowledge first, supporting memory second, recent conversational residue last. Triage exists to reduce drift, reduce noise, and choose the correct synthesis posture before any response is composed.",
    topics:       ["ai", "technology", "reasoning", "architecture"],
    constraints:  ["system", "structured", "technical"],
    writingStyle: "instructional",
  },

  {
    id: "seed_deluge_1",
    question: "What is the deluge of knowledge principle for BetaGrace local fallback?",
    answer:
      "The deluge of knowledge principle means BetaGrace should maintain a wide internal reservoir of foundational knowledge seeds across domains, but answer selectively rather than dumping everything at once. The engine should absorb broad knowledge coverage, then narrow intelligently by prompt context, topic match, mode fit, and operational intent so the final response feels distilled instead of flooded. Deluge must not collapse into blandness: when a user prompt calls for creative robustness, vividness, structural strength, or sharper intuition, the engine should preserve expressive force while still remaining relevant and distilled. The goal is disciplined richness — neither noisy overproduction nor sterile flatness.",
    topics:       ["ai", "technology", "reasoning", "knowledge", "creative"],
    constraints:  ["system", "technical", "knowledgebase", "creative_balance"],
    writingStyle: "analytical",
  },

  {
    id: "seed_local_synthesis_priority_1",
    question: "What priority order should local synthesis use when composing an answer?",
    answer:
      "Local synthesis should use a three-layer priority order: first foundational seed knowledge, second high-relevance supporting memory, third recent session residue only when it materially clarifies the answer. This keeps fallback grounded in stable knowledge while still preserving personalization where it helps.",
    topics:       ["ai", "technology", "architecture"],
    constraints:  ["system", "priority", "knowledgebase"],
    writingStyle: "instructional",
  },
];
