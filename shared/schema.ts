import { z } from "zod";

// AI Mode Types - Core system modes (5 exclusive modes)
// Faith is now a TOGGLE ENHANCEMENT (like Advanced Reasoning), not a mode
export const AI_MODES = {
  STANDARD: "standard",
  FLESH_ARCHITECT: "flesh_architect",
  SANCTUARY: "sanctuary",
  ADVANCED_REASONING: "advanced_reasoning",
  AUTONOMOUS: "autonomous",
  VIDEO_GENERATOR: "video_generator",
  CODE_GRAPH: "code_graph",
  ACADEMIC_RESEARCH: "academic_research",
} as const;

export type AIMode = (typeof AI_MODES)[keyof typeof AI_MODES];

// ALL MODES ARE MUTUALLY EXCLUSIVE - ONLY ONE ACTIVE AT A TIME
export const EXCLUSIVE_MODES: AIMode[] = [
  "standard",
  "flesh_architect",
  "sanctuary",
  "advanced_reasoning",
  "autonomous",
  "video_generator",
  "code_graph",
  "academic_research",
];

// No mode conflicts - all modes are exclusive to each other
export const MODE_CONFLICTS: Record<AIMode, AIMode[]> = {
  standard: [],
  flesh_architect: [],
  sanctuary: [],
  advanced_reasoning: [],
  autonomous: [],
  video_generator: [],
  code_graph: [],
  academic_research: [],
};

// No dependencies - modes work independently
export const MODE_DEPENDENCIES: Record<AIMode, AIMode[]> = {
  standard: [],
  flesh_architect: [],
  sanctuary: [],
  advanced_reasoning: [],
  autonomous: [],
  video_generator: [],
  code_graph: [],
  academic_research: [],
};

// Mode definitions with metadata (8 exclusive modes)
export const MODE_METADATA: Record<
  AIMode,
  {
    name: string;
    description: string;
    command: string;
    isExclusive: boolean;
    icon: string;
  }
> = {
  standard: {
    name: "Standard",
    description:
      "Default protective mode with balanced creative writing assistance",
    command: "RETURN",
    isExclusive: true,
    icon: "shield",
  },
  flesh_architect: {
    name: "Flesh Architect",
    description:
      "Intense body horror and visceral prose mechanics (Requires Advanced Reasoning)",
    command: "ARCHITECT_ACTIVE",
    isExclusive: true,
    icon: "skull",
  },
  sanctuary: {
    name: "Sanctuary",
    description:
      "Safe creative space with protective boundaries (Exclusive mode)",
    command: "SANCTUARY+",
    isExclusive: true,
    icon: "heart",
  },
  advanced_reasoning: {
    name: "Advanced Reasoning",
    description: "Deep analytical thinking for complex narrative problems",
    command: "THINK_DEEP",
    isExclusive: true,
    icon: "brain",
  },
  autonomous: {
    name: "Autonomous",
    description:
      "Self-directed creative mode with parallel learning capabilities for complex multi-step tasks",
    command: "AUTO_ENGAGE",
    isExclusive: true,
    icon: "sparkles",
  },
  video_generator: {
    name: "Video Generator",
    description:
      "Specialized mode for cinematic AI video creation and animation",
    command: "VIDEO_START",
    isExclusive: true,
    icon: "video",
  },
  code_graph: {
    name: "Code Graph",
    description:
      "Code intelligence mode — paste any code for instant knowledge graph analysis: functions, classes, imports, call relationships, and architecture overview",
    command: "CODEGRAPH_ANALYZE",
    isExclusive: true,
    icon: "network",
  },
  academic_research: {
    name: "Academic Research",
    description:
      "Full academic pipeline: research → outline → write → review → revise → finalize. APA 7.0, literature review, citation checking, and revision coaching",
    command: "ARS_ENGAGE",
    isExclusive: true,
    icon: "graduation-cap",
  },
};

// Faith Enhancement Metadata (universal toggle that enhances any mode)
export const FAITH_ENHANCEMENT_METADATA = {
  name: "Faith Enhancement",
  description:
    "Christian theological enhancement grounded in divine truth. Divine wisdom comes from knowing God through Christ. Sin is choosing our own truth over God's. Truth flows solely from Jesus Christ and the Holy Spirit. Grace meets us in surrender and love of God and neighbor - love found us when we were dead in sin.",
  command: "FAITH_ACTIVE",
  icon: "cross",
};

// Session schema - Age requirement: 18+
export const sessionSchema = z.object({
  id: z.string(),
  data: z.any().optional(),
  createdAt: z.string(),
  activeModes: z.array(
    z.enum([
      "standard",
      "flesh_architect",
      "sanctuary",
      "advanced_reasoning",
      "autonomous",
      "video_generator",
      "code_graph",
      "academic_research",
    ]),
  ),
  ageVerified: z.boolean(),
  isOver18: z.boolean().nullable(), // UPDATED: 18+ requirement
  consentGiven: z.boolean(),
  dataRetentionOptOut: z.boolean(),
  advancedReasoningEnabled: z.boolean().optional(), // Enhancement toggle for all modes
  faithEnhancementEnabled: z.boolean().optional(), // Faith enhancement toggle for all modes
  learningDataAcknowledged: z.boolean().optional(),
  learningDataAcknowledgedAt: z.string().nullable().optional(),
});

export type Session = z.infer<typeof sessionSchema>;
export type InsertSession = Omit<Session, "id" | "createdAt">;

// Message schema
export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  conversationId: z.string().optional(),
  data: z.any().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  mode: z.enum([
    "standard",
    "flesh_architect",
    "sanctuary",
    "advanced_reasoning",
    "autonomous",
    "video_generator",
    "code_graph",
    "academic_research",
  ]),
  timestamp: z.string(),
  tokens: z.number().optional(),
});

export type Message = z.infer<typeof messageSchema>;
export type InsertMessage = Omit<Message, "id" | "timestamp">;

// Conversation schema
export const conversationSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  data: z.any().optional(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
  activeModes: z.array(
    z.enum([
      "standard",
      "flesh_architect",
      "sanctuary",
      "advanced_reasoning",
      "autonomous",
      "video_generator",
      "code_graph",
      "academic_research",
    ]),
  ),
});

export type Conversation = z.infer<typeof conversationSchema>;
export type InsertConversation = Omit<
  Conversation,
  "id" | "createdAt" | "updatedAt"
>;

// Privacy consent schema
export const consentSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  essentialCookies: z.boolean(),
  analyticsCookies: z.boolean(),
  functionalCookies: z.boolean(),
  dataRetention: z.boolean(),
  marketingCommunications: z.boolean(),
  thirdPartySharing: z.boolean(),
  consentDate: z.string(),
  lastUpdated: z.string(),
});

export type Consent = z.infer<typeof consentSchema>;
export type InsertConsent = Omit<Consent, "id" | "consentDate" | "lastUpdated">;

// Parallel learning data schema
export const learningDataSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  patternType: z.enum([
    "writing_style",
    "mode_preference",
    "topic_interest",
    "feedback",
    "story_element",
    "narrative_theme",
    "character_detail",
    "plot_point",
  ]),
  patternData: z.string(),
  data: z.any(),
  weight: z.number(),
  createdAt: z.string(),
});

export type LearningData = z.infer<typeof learningDataSchema>;
export type InsertLearningData = Omit<LearningData, "id" | "createdAt">;

// Long-term memory index schema - persistent learning at 1 trillion token scale
export const longTermMemorySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  memoryType: z.enum([
    "user_pattern",
    "writing_signature",
    "thematic_preference",
    "behavioral_trend",
    "semantic_cluster",
  ]),
  summary: z.string(), // Compressed representation of many patterns
  semanticHash: z.string(), // For grouping similar memories
  occurrences: z.number(), // How many times pattern appeared
  totalWeight: z.number(), // Cumulative importance
  relatedPatterns: z.array(z.string()), // IDs of underlying patterns
  lastUpdated: z.string(),
  createdAt: z.string(),
  confidenceScore: z.number(), // 0-1 confidence in pattern validity
  tokenEstimate: z.number(), // Estimated tokens this memory represents
});

export type LongTermMemory = z.infer<typeof longTermMemorySchema>;
export type InsertLongTermMemory = Omit<
  LongTermMemory,
  "id" | "createdAt" | "lastUpdated"
>;

// Data deletion request schema
export const deletionRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  requestType: z.enum(["full_deletion", "data_export", "opt_out"]),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  userMessage: z.string().nullable().optional(),
});

export type DeletionRequest = z.infer<typeof deletionRequestSchema>;
export type InsertDeletionRequest = Omit<
  DeletionRequest,
  "id" | "requestedAt" | "completedAt"
>;

// Chat request/response schemas
export const chatRequestSchema = z.object({
  message: z.string().min(1).max(40000),
  mode: z.enum([
    "standard",
    "flesh_architect",
    "sanctuary",
    "advanced_reasoning",
    "autonomous",
    "video_generator",
    "code_graph",
    "academic_research",
  ]),
  conversationId: z.string().optional(),
  advancedReasoningEnabled: z.boolean().optional(), // Enhancement toggle (default: true)
  faithEnhancementEnabled: z.boolean().optional(), // Faith enhancement toggle (can enhance any mode)
  bookTitles: z.array(z.string()).optional(),
  bookNarrativeVoice: z.string().optional(),
  bookContext: z.array(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  response: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  mode: z.enum([
    "standard",
    "flesh_architect",
    "sanctuary",
    "advanced_reasoning",
    "autonomous",
    "video_generator",
    "code_graph",
    "academic_research",
  ]),
  tokensUsed: z.number(),
  learningInsights: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  aiProvider: z.string().optional(),
  advancedReasoningApplied: z.boolean().optional(),
  faithEnhancementApplied: z.boolean().optional(),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

// Age verification schema
export const ageVerificationSchema = z.object({
  isOver18: z.boolean(), // UPDATED: 18+ requirement (Age of Majority)
  verifiedAt: z.string(),
});

export type AgeVerification = z.infer<typeof ageVerificationSchema>;
