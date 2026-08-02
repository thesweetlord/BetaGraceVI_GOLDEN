import {
  pgTable,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  data: jsonb("data").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  activeModes: text("active_modes").array().default(["standard"]),
  ageVerified: boolean("age_verified").default(false),
  isOver18: boolean("is_over_18"),
  consentGiven: boolean("consent_given").default(false),
  dataRetentionOptOut: boolean("data_retention_opt_out").default(false),
  advancedReasoningEnabled: boolean("advanced_reasoning_enabled").default(true),
  faithEnhancementEnabled: boolean("faith_enhancement_enabled").default(false),
  learningDataAcknowledged: boolean("learning_data_acknowledged").default(
    false,
  ),
  learningDataAcknowledgedAt: timestamp("learning_data_acknowledged_at", {
    withTimezone: true,
  }),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  messageCount: integer("message_count").default(0),
  activeModes: text("active_modes").array().default(["standard"]),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  data: jsonb("data").notNull().default({}),
  role: text("role").notNull(),
  content: text("content").notNull(),
  mode: text("mode").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  tokens: integer("tokens"),
});

export const consent = pgTable("consent", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  essentialCookies: boolean("essential_cookies").default(true),
  analyticsCookies: boolean("analytics_cookies").default(false),
  functionalCookies: boolean("functional_cookies").default(false),
  dataRetention: boolean("data_retention").default(false),
  marketingCommunications: boolean("marketing_communications").default(false),
  thirdPartySharing: boolean("third_party_sharing").default(false),
  consentDate: timestamp("consent_date", { withTimezone: true }).defaultNow(),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
});

export const learningData = pgTable("learning_data", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  patternType: text("pattern_type").notNull(),
  patternData: text("pattern_data").notNull(),
  data: jsonb("data").notNull().default({}),
  weight: numeric("weight").default("1.0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const longTermMemory = pgTable("long_term_memory", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  memoryType: text("memory_type").notNull(),
  summary: text("summary").notNull(),
  semanticHash: text("semantic_hash").notNull(),
  occurrences: integer("occurrences").default(1),
  totalWeight: numeric("total_weight").default("1.0"),
  relatedPatterns: text("related_patterns").array().default([]),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  confidenceScore: numeric("confidence_score").default("0.5"),
  tokenEstimate: integer("token_estimate").default(0),
});

export const deletionRequests = pgTable("deletion_requests", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  requestType: text("request_type").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  userMessage: text("user_message"),
});

export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  rawIntent: text("raw_intent").notNull(),
  masterSeed: integer("master_seed").notNull(),
  totalScenes: integer("total_scenes").notNull(),
  globalStyle: text("global_style")
    .notNull()
    .default("photorealistic, cinematic, 8K"),
  globalCharacterAnchor: text("global_character_anchor"),
  ffmpegPolicy: jsonb("ffmpeg_policy").notNull().default({}),
  status: text("status").notNull().default("hydrated"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const videoScenes = pgTable("video_scenes", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => videoJobs.id, { onDelete: "cascade" }),
  sceneIndex: integer("scene_index").notNull(),
  sceneId: text("scene_id").notNull(),
  positivePrompt: text("positive_prompt").notNull(),
  components: jsonb("components").notNull().default({}),
  negativeOverrides: text("negative_overrides").array().default([]),
  cameraMotion: text("camera_motion").notNull().default("ken_burns"),
  durationSeconds: numeric("duration_seconds").notNull().default("5.0"),
  coherenceGroup: integer("coherence_group").notNull().default(1),
  seed: integer("seed").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Artifacts ─────────────────────────────────────────────────────────────
// Persistent storage for academic artifact pipeline outputs.
// Replaces in-memory Map — survives server restarts and multi-instance deploys.
export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: text("job_id").notNull().unique(),
  sessionId: text("session_id"),
  topic: text("topic").notNull(),
  status: text("status").notNull().default("pending"),
  artifact: text("artifact"),
  charCount: integer("char_count"),
  sectionsCompleted: integer("sections_completed").notNull().default(0),
  totalSections: integer("total_sections").notNull().default(7),
  modeContext: text("mode_context"),
  error: text("error"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
