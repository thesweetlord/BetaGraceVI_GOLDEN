import { randomUUID } from "crypto";
import { db } from "./db.js";
import { eq, desc, asc, sql } from "drizzle-orm";
import {
  sessions,
  messages,
  conversations,
  consent,
  learningData,
  longTermMemory,
  deletionRequests,
} from "@shared/db-schema";
import type {
  Session,
  InsertSession,
  Message,
  InsertMessage,
  Conversation,
  InsertConversation,
  Consent,
  InsertConsent,
  LearningData,
  InsertLearningData,
  DeletionRequest,
  InsertDeletionRequest,
  LongTermMemory,
  InsertLongTermMemory,
} from "@shared/schema";

const normalizeDate = (value: Date | string | undefined | null): string => {
  if (!value) {
    return new Date().toISOString();
  }
  return typeof value === "string"
    ? new Date(value).toISOString()
    : value.toISOString();
};

const normalizeDateOrUndefined = (
  value: Date | string | undefined | null,
): string | undefined => {
  if (value == null) {
    return undefined;
  }
  return typeof value === "string"
    ? new Date(value).toISOString()
    : value.toISOString();
};

export interface IStorage {
  // Sessions
  getSession(id: string): Promise<Session | undefined>;
  createSession(session: InsertSession, customId?: string): Promise<Session>;
  updateSession(
    id: string,
    updates: Partial<Session>,
  ): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;

  // Messages
  getMessages(sessionId: string): Promise<Message[]>;
  getMessagesByConversation(conversationId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  deleteMessagesBySession(sessionId: string): Promise<boolean>;

  // Conversations
  getConversation(id: string): Promise<Conversation | undefined>;
  getConversationsBySession(sessionId: string): Promise<Conversation[]>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  updateConversation(
    id: string,
    updates: Partial<Conversation>,
  ): Promise<Conversation | undefined>;
  deleteConversation(id: string): Promise<boolean>;

  // Consent
  getConsent(sessionId: string): Promise<Consent | undefined>;
  createConsent(consent: InsertConsent): Promise<Consent>;
  updateConsent(
    sessionId: string,
    updates: Partial<Consent>,
  ): Promise<Consent | undefined>;
  deleteConsent(sessionId: string): Promise<boolean>;

  // Learning Data
  getLearningData(sessionId: string): Promise<LearningData[]>;
  createLearningData(data: InsertLearningData): Promise<LearningData>;
  deleteLearningDataBySession(sessionId: string): Promise<boolean>;

  // Long-term Memory (1 trillion token scale persistent learning)
  getLongTermMemory(
    sessionId: string,
    limit?: number,
  ): Promise<LongTermMemory[]>;
  getLongTermMemoryByType(
    sessionId: string,
    type: string,
  ): Promise<LongTermMemory[]>;
  createLongTermMemory(memory: InsertLongTermMemory): Promise<LongTermMemory>;
  updateLongTermMemory(
    id: string,
    updates: Partial<LongTermMemory>,
  ): Promise<LongTermMemory | undefined>;
  deleteLongTermMemoryBySession(sessionId: string): Promise<boolean>;
  aggregateAndCompressMemory(sessionId: string): Promise<LongTermMemory[]>;

  // Deletion Requests
  getDeletionRequest(id: string): Promise<DeletionRequest | undefined>;
  getDeletionRequestBySession(
    sessionId: string,
  ): Promise<DeletionRequest | undefined>;
  listAllDeletionRequests(): Promise<DeletionRequest[]>;
  createDeletionRequest(
    request: InsertDeletionRequest,
  ): Promise<DeletionRequest>;
  updateDeletionRequest(
    id: string,
    updates: Partial<DeletionRequest>,
  ): Promise<DeletionRequest | undefined>;

  // Privacy operations
  deleteAllUserData(sessionId: string): Promise<boolean>;
  exportUserData(sessionId: string): Promise<object>;
  clearSessionMessages(sessionId: string): Promise<boolean>;
  purgeExpiredSessions(daysOld: number): Promise<number>;
  purgeExpiredConsents(monthsOld: number): Promise<number>;

  // Rate limiting & spam detection
  checkRateLimit(
    sessionId: string,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export class MemStorage implements IStorage {
  private sessions: Map<string, Session>;
  private messages: Map<string, Message>;
  private conversations: Map<string, Conversation>;
  private consents: Map<string, Consent>;
  private learningData: Map<string, LearningData>;
  private longTermMemory: Map<string, LongTermMemory>;
  private deletionRequests: Map<string, DeletionRequest>;
  private lastMessageTimestamp: Map<string, number>; // SPAM DETECTION: Track last message time per session

  constructor() {
    this.sessions = new Map();
    this.messages = new Map();
    this.conversations = new Map();
    this.consents = new Map();
    this.learningData = new Map();
    this.longTermMemory = new Map();
    this.deletionRequests = new Map();
    this.lastMessageTimestamp = new Map(); // Initialize timestamp tracker
  }

  // Sessions
  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async createSession(
    session: InsertSession,
    customId?: string,
  ): Promise<Session> {
    const id = customId || randomUUID();
    const newSession: Session = {
      ...session,
      id,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, newSession);
    return newSession;
  }

  async updateSession(
    id: string,
    updates: Partial<Session>,
  ): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const updated = { ...session, ...updates };
    this.sessions.set(id, updated);
    return updated;
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = this.sessions.delete(id);
    // Mirror the database behavior: retain consent audit records but detach them
    // from the deleted session so purge counts do not repeat on next startup.
    if (deleted) {
      for (const [consentId, consentRecord] of this.consents.entries()) {
        if (consentRecord.sessionId === id) {
          this.consents.set(consentId, {
            ...consentRecord,
            sessionId: null,
            lastUpdated: new Date().toISOString(),
          });
        }
      }
      this.lastMessageTimestamp.delete(id);
    }
    return deleted;
  }

  // Messages
  async getMessages(sessionId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
  }

  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];
    return Array.from(this.messages.values())
      .filter((m) => m.conversationId === conversationId)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const newMessage: Message = {
      ...message,
      id,
      timestamp: new Date().toISOString(),
    };
    this.messages.set(id, newMessage);
    return newMessage;
  }

  async deleteMessagesBySession(sessionId: string): Promise<boolean> {
    const messagesToDelete = Array.from(this.messages.entries()).filter(
      ([_, m]) => m.sessionId === sessionId,
    );
    messagesToDelete.forEach(([id]) => this.messages.delete(id));
    return true;
  }

  // Conversations
  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async getConversationsBySession(sessionId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values())
      .filter((c) => c.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  async createConversation(
    conversation: InsertConversation,
  ): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newConversation: Conversation = {
      ...conversation,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(id, newConversation);
    return newConversation;
  }

  async updateConversation(
    id: string,
    updates: Partial<Conversation>,
  ): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(id);
    if (!conversation) return undefined;
    const updated = {
      ...conversation,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(id, updated);
    return updated;
  }

  async deleteConversation(id: string): Promise<boolean> {
    return this.conversations.delete(id);
  }

  // Consent
  async getConsent(sessionId: string): Promise<Consent | undefined> {
    return Array.from(this.consents.values()).find(
      (c) => c.sessionId === sessionId,
    );
  }

  async createConsent(consent: InsertConsent): Promise<Consent> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newConsent: Consent = {
      ...consent,
      id,
      consentDate: now,
      lastUpdated: now,
    };
    this.consents.set(id, newConsent);
    return newConsent;
  }

  async updateConsent(
    sessionId: string,
    updates: Partial<Consent>,
  ): Promise<Consent | undefined> {
    const consent = await this.getConsent(sessionId);
    if (!consent) return undefined;
    const updated = {
      ...consent,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    this.consents.set(consent.id, updated);
    return updated;
  }

  async deleteConsent(sessionId: string): Promise<boolean> {
    const consent = await this.getConsent(sessionId);
    if (!consent) return false;
    return this.consents.delete(consent.id);
  }

  // Learning Data
  async getLearningData(sessionId: string): Promise<LearningData[]> {
    return Array.from(this.learningData.values()).filter(
      (l) => l.sessionId === sessionId,
    );
  }

  async createLearningData(data: InsertLearningData): Promise<LearningData> {
    const id = randomUUID();
    const newData: LearningData = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
    };
    this.learningData.set(id, newData);
    return newData;
  }

  async deleteLearningDataBySession(sessionId: string): Promise<boolean> {
    const dataToDelete = Array.from(this.learningData.entries()).filter(
      ([_, d]) => d.sessionId === sessionId,
    );
    dataToDelete.forEach(([id]) => this.learningData.delete(id));
    return true;
  }

  // Long-term Memory (1 trillion token scale persistent learning)
  async getLongTermMemory(
    sessionId: string,
    limit: number = 50,
  ): Promise<LongTermMemory[]> {
    return Array.from(this.longTermMemory.values())
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => b.totalWeight - a.totalWeight)
      .slice(0, limit);
  }

  async getLongTermMemoryByType(
    sessionId: string,
    type: string,
  ): Promise<LongTermMemory[]> {
    return Array.from(this.longTermMemory.values())
      .filter((m) => m.sessionId === sessionId && m.memoryType === type)
      .sort((a, b) => b.totalWeight - a.totalWeight);
  }

  async createLongTermMemory(
    memory: InsertLongTermMemory,
  ): Promise<LongTermMemory> {
    const id = randomUUID();
    const newMemory: LongTermMemory = {
      ...memory,
      id,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    this.longTermMemory.set(id, newMemory);
    return newMemory;
  }

  async updateLongTermMemory(
    id: string,
    updates: Partial<LongTermMemory>,
  ): Promise<LongTermMemory | undefined> {
    const memory = this.longTermMemory.get(id);
    if (!memory) return undefined;
    const updated = {
      ...memory,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    this.longTermMemory.set(id, updated);
    return updated;
  }

  async deleteLongTermMemoryBySession(sessionId: string): Promise<boolean> {
    const toDelete = Array.from(this.longTermMemory.entries()).filter(
      ([_, m]) => m.sessionId === sessionId,
    );
    toDelete.forEach(([id]) => this.longTermMemory.delete(id));
    return true;
  }

  // AGGREGATION & COMPRESSION: Compress many patterns into high-value memories
  async aggregateAndCompressMemory(
    sessionId: string,
  ): Promise<LongTermMemory[]> {
    const learningData = await this.getLearningData(sessionId);
    if (learningData.length === 0) return [];

    // CASCADE PREVENTION: Wipe stale LongTermMemory for this session before re-creating.
    // Without this, every 6-interaction cycle appends brand-new LTM entries on top of
    // old ones (which were already based on the same raw data), causing O(n²) growth.
    await this.deleteLongTermMemoryBySession(sessionId);

    const compressed: LongTermMemory[] = [];
    const typeGroups = new Map<string, LearningData[]>();

    // Group by pattern type
    for (const data of learningData) {
      const key = data.patternType;
      if (!typeGroups.has(key)) typeGroups.set(key, []);
      typeGroups.get(key)!.push(data);
    }

    // Compress each group into a high-value memory
    for (const [patternType, patterns] of typeGroups) {
      const totalWeight = patterns.reduce((sum, p) => sum + p.weight, 0);
      const occurrences = patterns.length;
      const semanticHash = this.generateSemanticHash(patterns);
      const summary = this.summarizePatterns(patterns, patternType);

      // Only create memory if significant
      if (occurrences >= 3 || totalWeight >= 2.0) {
        // SECURITY: Bound confidence score strictly between 0 and 1
        const confidenceScore = Math.max(
          0,
          Math.min(1.0, totalWeight / (occurrences * 5)),
        );
        const memory = await this.createLongTermMemory({
          sessionId,
          memoryType: this.mapPatternToMemoryType(patternType),
          summary,
          semanticHash,
          occurrences,
          totalWeight,
          relatedPatterns: patterns.map((p) => p.id),
          confidenceScore,
          tokenEstimate: occurrences * 150,
        });
        compressed.push(memory);
      }
    }

    // POISON PREVENTION: Delete the raw learning data that was just compressed.
    // Without this, the next compression cycle re-reads all the same raw entries
    // and creates yet more duplicate LongTermMemory rows (the other half of O(n²)).
    await this.deleteLearningDataBySession(sessionId);

    return compressed;
  }

  private generateSemanticHash(patterns: LearningData[]): string {
    const combined = patterns.map((p) => p.patternData).join("|");
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private summarizePatterns(patterns: LearningData[], type: string): string {
    if (type === "writing_style") {
      return `User prefers ${patterns.length} specific writing patterns`;
    } else if (type === "mode_preference") {
      return `User favors modes used in ${patterns.length} recent interactions`;
    } else if (type === "topic_interest") {
      return `User shows sustained interest across ${patterns.length} topic areas`;
    }
    return `Aggregated pattern from ${patterns.length} observations`;
  }

  private mapPatternToMemoryType(
    patternType: string,
  ):
    | "user_pattern"
    | "writing_signature"
    | "thematic_preference"
    | "behavioral_trend"
    | "semantic_cluster" {
    const mapping: Record<string, any> = {
      writing_style: "writing_signature",
      mode_preference: "behavioral_trend",
      topic_interest: "thematic_preference",
      feedback: "user_pattern",
    };
    return mapping[patternType] || "user_pattern";
  }

  // Deletion Requests
  async getDeletionRequest(id: string): Promise<DeletionRequest | undefined> {
    return this.deletionRequests.get(id);
  }

  async getDeletionRequestBySession(
    sessionId: string,
  ): Promise<DeletionRequest | undefined> {
    const all = Array.from(this.deletionRequests.values())
      .filter((r) => r.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
      );
    return all[0];
  }

  async listAllDeletionRequests(): Promise<DeletionRequest[]> {
    return Array.from(this.deletionRequests.values()).sort(
      (a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
  }

  async createDeletionRequest(
    request: InsertDeletionRequest,
  ): Promise<DeletionRequest> {
    const id = randomUUID();
    const newRequest: DeletionRequest = {
      ...request,
      id,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.deletionRequests.set(id, newRequest);
    return newRequest;
  }

  async updateDeletionRequest(
    id: string,
    updates: Partial<DeletionRequest>,
  ): Promise<DeletionRequest | undefined> {
    const request = this.deletionRequests.get(id);
    if (!request) return undefined;
    const updated = { ...request, ...updates };
    this.deletionRequests.set(id, updated);
    return updated;
  }

  // Privacy operations
  // Privacy: Clear all messages for session
  async clearSessionMessages(sessionId: string): Promise<boolean> {
    return this.deleteMessagesBySession(sessionId);
  }

  async deleteAllUserData(sessionId: string): Promise<boolean> {
    await this.deleteMessagesBySession(sessionId);

    // Delete all conversations for this session
    const conversations = await this.getConversationsBySession(sessionId);
    conversations.forEach((c) => this.conversations.delete(c.id));

    // Preserve the consent log for audit while removing user interaction data.
    // Keep AI learning data intact and still associated with the session,
    // since users already consented to AI learning.
    return true;
  }

  async purgeExpiredSessions(daysOld: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let purged = 0;
    for (const [id, session] of this.sessions.entries()) {
      const sessionCreated = new Date(session.createdAt as string);
      // Proxy "last interaction" via the most recent conversation updatedAt for this session.
      const sessionConvos = Array.from(this.conversations.values()).filter(
        (c) => c.sessionId === id,
      );
      const lastActivity =
        sessionConvos.length > 0
          ? new Date(
              Math.max(
                ...sessionConvos.map((c) =>
                  new Date(c.updatedAt as string).getTime(),
                ),
              ),
            )
          : sessionCreated;
      if (lastActivity < cutoff) {
        await this.deleteAllUserData(id);
        await this.deleteSession(id);
        purged++;
      }
    }
    return purged;
  }

  async purgeExpiredConsents(monthsOld: number): Promise<number> {
    // Consent records are retained for a MINIMUM of monthsOld months for legal audit purposes.
    // This job deletes them only after that window has passed.
    const cutoff = new Date(Date.now() - monthsOld * 30 * 24 * 60 * 60 * 1000);
    let purged = 0;
    for (const [id, record] of this.consents.entries()) {
      const recorded = new Date(record.consentDate as string);
      if (recorded < cutoff) {
        this.consents.delete(id);
        purged++;
      }
    }
    return purged;
  }

  async exportUserData(sessionId: string): Promise<object> {
    const session = await this.getSession(sessionId);
    const messages = await this.getMessages(sessionId);
    const conversations = await this.getConversationsBySession(sessionId);
    const consent = await this.getConsent(sessionId);
    const learning = await this.getLearningData(sessionId);
    const longTermMemory = await this.getLongTermMemory(sessionId, 1000);

    return {
      exportDate: new Date().toISOString(),
      session,
      conversations,
      messages,
      consent,
      learningData: learning,
      persistentMemory: longTermMemory,
    };
  }

  // SPAM DETECTION: Check if message violates rate limit (>1 message within 100ms)
  async checkRateLimit(
    sessionId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now();
    const lastTime = this.lastMessageTimestamp.get(sessionId);

    if (lastTime !== undefined && now - lastTime < 100) {
      // VIOLATION: Message sent within 100ms of previous message
      // Terminate session immediately
      const deleted = await this.deleteSession(sessionId);
      if (!deleted) {
        // Session already deleted, just return blocked
        this.lastMessageTimestamp.delete(sessionId);
        return {
          allowed: false,
          reason: "Session already terminated or not found.",
        };
      }
      return {
        allowed: false,
        reason: "Rapid message flooding detected. Session terminated.",
      };
    }

    // Update timestamp for this session (only on allowed path)
    this.lastMessageTimestamp.set(sessionId, now);
    return { allowed: true };
  }
}

export class PgStorage implements IStorage {
  // Sessions
  async getSession(id: string): Promise<Session | undefined> {
    if (!db) throw new Error("Database not available");
    const result = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      createdAt: result[0].createdAt?.toISOString() || new Date().toISOString(),
      activeModes: (result[0].activeModes || [
        "standard",
      ]) as Session["activeModes"],
      ageVerified: result[0].ageVerified ?? false,
      consentGiven: result[0].consentGiven ?? false,
      dataRetentionOptOut: result[0].dataRetentionOptOut ?? false,
      advancedReasoningEnabled: result[0].advancedReasoningEnabled ?? true,
      faithEnhancementEnabled: result[0].faithEnhancementEnabled ?? false,
      learningDataAcknowledged: result[0].learningDataAcknowledged ?? false,
      learningDataAcknowledgedAt:
        result[0].learningDataAcknowledgedAt?.toISOString() ?? null,
    };
  }

  async createSession(
    session: InsertSession,
    customId?: string,
  ): Promise<Session> {
    const id = customId || randomUUID();
    try {
      const [newSession] = await db
        .insert(sessions)
        .values({
          ...session,
          id,
          data: session.data ?? {},
          createdAt: new Date(),
        })
        .returning();
      return {
        ...newSession,
        createdAt:
          newSession.createdAt?.toISOString() || new Date().toISOString(),
        activeModes: (newSession.activeModes || [
          "standard",
        ]) as Session["activeModes"],
        ageVerified: newSession.ageVerified ?? false,
        consentGiven: newSession.consentGiven ?? false,
        dataRetentionOptOut: newSession.dataRetentionOptOut ?? false,
        advancedReasoningEnabled: newSession.advancedReasoningEnabled ?? true,
        faithEnhancementEnabled: newSession.faithEnhancementEnabled ?? false,
        learningDataAcknowledged: newSession.learningDataAcknowledged ?? false,
        learningDataAcknowledgedAt:
          newSession.learningDataAcknowledgedAt?.toISOString() ?? null,
      };
    } catch (error: any) {
      if (
        error?.cause?.code === "23505" ||
        error?.code === "23505" ||
        /duplicate key value/.test(error?.message ?? "")
      ) {
        const existingSession = await this.getSession(id);
        if (existingSession) {
          return existingSession;
        }
      }
      throw error;
    }
  }

  async updateSession(
    id: string,
    updates: Partial<Session>,
  ): Promise<Session | undefined> {
    const updateData: any = { ...updates };
    if (updateData.createdAt && typeof updateData.createdAt === "string") {
      updateData.createdAt = new Date(updateData.createdAt);
    }
    if (
      updateData.learningDataAcknowledgedAt &&
      typeof updateData.learningDataAcknowledgedAt === "string"
    ) {
      updateData.learningDataAcknowledgedAt = new Date(
        updateData.learningDataAcknowledgedAt,
      );
    }
    const [updated] = await db
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, id))
      .returning();
    if (!updated) return undefined;
    return {
      ...updated,
      createdAt: updated.createdAt?.toISOString() || new Date().toISOString(),
      activeModes: (updated.activeModes || [
        "standard",
      ]) as Session["activeModes"],
      ageVerified: updated.ageVerified ?? false,
      consentGiven: updated.consentGiven ?? false,
      dataRetentionOptOut: updated.dataRetentionOptOut ?? false,
      advancedReasoningEnabled: updated.advancedReasoningEnabled ?? true,
      faithEnhancementEnabled: updated.faithEnhancementEnabled ?? false,
      learningDataAcknowledged: updated.learningDataAcknowledged ?? false,
      learningDataAcknowledgedAt:
        updated.learningDataAcknowledgedAt?.toISOString() ?? null,
    };
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await db.delete(sessions).where(eq(sessions.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Messages
  async getMessages(sessionId: string): Promise<Message[]> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.timestamp));
    return result.map((msg: Message) => ({
      ...msg,
      timestamp: normalizeDate(msg.timestamp),
      role: msg.role as Message["role"],
      mode: msg.mode as Message["mode"],
      tokens: msg.tokens || undefined,
    }));
  }

  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.timestamp));
    return result.map((msg: Message) => ({
      ...msg,
      timestamp: normalizeDate(msg.timestamp),
      role: msg.role as Message["role"],
      mode: msg.mode as Message["mode"],
      tokens: msg.tokens || undefined,
    }));
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const [newMessage] = await db
      .insert(messages)
      .values({
        ...message,
        id,
        data: message.data ?? {},
      })
      .returning();
    return {
      ...newMessage,
      timestamp: normalizeDate(newMessage.timestamp),
      role: newMessage.role as Message["role"],
      mode: newMessage.mode as Message["mode"],
      tokens: newMessage.tokens || undefined,
    };
  }

  async deleteMessagesBySession(sessionId: string): Promise<boolean> {
    const result = await db
      .delete(messages)
      .where(eq(messages.sessionId, sessionId));
    return (result.rowCount || 0) > 0;
  }

  // Conversations
  async getConversation(id: string): Promise<Conversation | undefined> {
    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      createdAt: normalizeDate(result[0].createdAt),
      updatedAt: normalizeDate(result[0].updatedAt),
      activeModes: (result[0].activeModes || [
        "standard",
      ]) as Conversation["activeModes"],
      messageCount: result[0].messageCount || 0,
    };
  }

  async getConversationsBySession(sessionId: string): Promise<Conversation[]> {
    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.sessionId, sessionId))
      .orderBy(desc(conversations.updatedAt));
    return result.map((conv: Conversation) => ({
      ...conv,
      createdAt: normalizeDate(conv.createdAt),
      updatedAt: normalizeDate(conv.updatedAt),
      activeModes: (conv.activeModes || [
        "standard",
      ]) as Conversation["activeModes"],
      messageCount: conv.messageCount || 0,
    }));
  }

  async createConversation(
    conversation: InsertConversation,
  ): Promise<Conversation> {
    const id = randomUUID();
    const [newConversation] = await db
      .insert(conversations)
      .values({
        ...conversation,
        id,
        data: conversation.data ?? {},
      })
      .returning();
    return {
      ...newConversation,
      createdAt: normalizeDate(newConversation.createdAt),
      updatedAt: normalizeDate(newConversation.updatedAt),
      activeModes: (newConversation.activeModes || [
        "standard",
      ]) as Conversation["activeModes"],
      messageCount: newConversation.messageCount || 0,
    };
  }

  async updateConversation(
    id: string,
    updates: Partial<Conversation>,
  ): Promise<Conversation | undefined> {
    const updateData: any = { ...updates };
    if (updateData.createdAt && typeof updateData.createdAt === "string") {
      updateData.createdAt = new Date(updateData.createdAt);
    }
    if (updateData.updatedAt && typeof updateData.updatedAt === "string") {
      updateData.updatedAt = new Date(updateData.updatedAt);
    }
    const [updated] = await db
      .update(conversations)
      .set(updateData)
      .where(eq(conversations.id, id))
      .returning();
    if (!updated) return undefined;
    return {
      ...updated,
      createdAt: normalizeDate(updated.createdAt),
      updatedAt: normalizeDate(updated.updatedAt),
      activeModes: (updated.activeModes || [
        "standard",
      ]) as Conversation["activeModes"],
      messageCount: updated.messageCount || 0,
    };
  }

  async deleteConversation(id: string): Promise<boolean> {
    const result = await db
      .delete(conversations)
      .where(eq(conversations.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Consent
  async getConsent(sessionId: string): Promise<Consent | undefined> {
    const result = await db
      .select()
      .from(consent)
      .where(eq(consent.sessionId, sessionId))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      consentDate: normalizeDate(result[0].consentDate),
      lastUpdated: normalizeDate(result[0].lastUpdated),
      essentialCookies: result[0].essentialCookies || false,
      analyticsCookies: result[0].analyticsCookies || false,
      functionalCookies: result[0].functionalCookies || false,
      dataRetention: result[0].dataRetention || false,
      marketingCommunications: result[0].marketingCommunications || false,
      thirdPartySharing: result[0].thirdPartySharing || false,
    };
  }

  async createConsent(consentData: InsertConsent): Promise<Consent> {
    const id = randomUUID();
    const [newConsent] = await db
      .insert(consent)
      .values({
        ...consentData,
        id,
      })
      .returning();
    return {
      ...newConsent,
      consentDate: normalizeDate(newConsent.consentDate),
      lastUpdated: normalizeDate(newConsent.lastUpdated),
      essentialCookies: newConsent.essentialCookies || false,
      analyticsCookies: newConsent.analyticsCookies || false,
      functionalCookies: newConsent.functionalCookies || false,
      dataRetention: newConsent.dataRetention || false,
      marketingCommunications: newConsent.marketingCommunications || false,
      thirdPartySharing: newConsent.thirdPartySharing || false,
    };
  }

  async updateConsent(
    sessionId: string,
    updates: Partial<Consent>,
  ): Promise<Consent | undefined> {
    const updateData: any = { ...updates };
    if (updateData.consentDate) {
      updateData.consentDate = new Date(updateData.consentDate);
    }
    if (updateData.lastUpdated) {
      updateData.lastUpdated = new Date(updateData.lastUpdated);
    }
    const [updated] = await db
      .update(consent)
      .set(updateData)
      .where(eq(consent.sessionId, sessionId))
      .returning();
    if (!updated) return undefined;
    return {
      ...updated,
      consentDate: normalizeDate(updated.consentDate),
      lastUpdated: normalizeDate(updated.lastUpdated),
      essentialCookies: updated.essentialCookies || false,
      analyticsCookies: updated.analyticsCookies || false,
      functionalCookies: updated.functionalCookies || false,
      dataRetention: updated.dataRetention || false,
      marketingCommunications: updated.marketingCommunications || false,
      thirdPartySharing: updated.thirdPartySharing || false,
    };
  }

  async deleteConsent(sessionId: string): Promise<boolean> {
    const result = await db
      .delete(consent)
      .where(eq(consent.sessionId, sessionId));
    return (result.rowCount || 0) > 0;
  }

  // Learning Data
  async getLearningData(sessionId: string): Promise<LearningData[]> {
    const result = await db
      .select()
      .from(learningData)
      .where(eq(learningData.sessionId, sessionId))
      .orderBy(desc(learningData.createdAt));
    return result.map((data: LearningData) => ({
      ...data,
      createdAt: normalizeDate(data.createdAt),
    }));
  }

  async createLearningData(data: InsertLearningData): Promise<LearningData> {
    const id = randomUUID();
    const [newData] = await db
      .insert(learningData)
      .values({
        ...data,
        id,
        data: data.data ?? {},
      })
      .returning();
    return {
      ...newData,
      createdAt: normalizeDate(newData.createdAt),
    };
  }

  async deleteLearningDataBySession(sessionId: string): Promise<boolean> {
    const result = await db
      .delete(learningData)
      .where(eq(learningData.sessionId, sessionId));
    return (result.rowCount || 0) > 0;
  }

  // Long-term Memory
  async getLongTermMemory(
    sessionId: string,
    limit: number = 50,
  ): Promise<LongTermMemory[]> {
    const result = await db
      .select()
      .from(longTermMemory)
      .where(eq(longTermMemory.sessionId, sessionId))
      .orderBy(desc(longTermMemory.totalWeight))
      .limit(limit);
    return result.map((memory: LongTermMemory) => ({
      ...memory,
      lastUpdated: normalizeDate(memory.lastUpdated),
      createdAt: normalizeDate(memory.createdAt),
    }));
  }

  async getLongTermMemoryByType(
    sessionId: string,
    type: string,
  ): Promise<LongTermMemory[]> {
    const result = await db
      .select()
      .from(longTermMemory)
      .where(
        sql`${longTermMemory.sessionId} = ${sessionId} AND ${longTermMemory.memoryType} = ${type}`,
      )
      .orderBy(desc(longTermMemory.totalWeight));
    return result.map((memory: LongTermMemory) => ({
      ...memory,
      lastUpdated: normalizeDate(memory.lastUpdated),
      createdAt: normalizeDate(memory.createdAt),
    }));
  }

  async createLongTermMemory(
    memory: InsertLongTermMemory,
  ): Promise<LongTermMemory> {
    const id = randomUUID();
    const [newMemory] = await db
      .insert(longTermMemory)
      .values({
        ...memory,
        id,
      })
      .returning();
    return {
      ...newMemory,
      lastUpdated: normalizeDate(newMemory.lastUpdated),
      createdAt: normalizeDate(newMemory.createdAt),
    };
  }

  async updateLongTermMemory(
    id: string,
    updates: Partial<LongTermMemory>,
  ): Promise<LongTermMemory | undefined> {
    const updateData: any = { ...updates };
    if (updateData.lastUpdated) {
      updateData.lastUpdated = new Date(updateData.lastUpdated);
    }
    if (updateData.createdAt) {
      updateData.createdAt = new Date(updateData.createdAt);
    }
    const [updated] = await db
      .update(longTermMemory)
      .set(updateData)
      .where(eq(longTermMemory.id, id))
      .returning();
    if (!updated) return undefined;
    return {
      ...updated,
      lastUpdated: normalizeDate(updated.lastUpdated),
      createdAt: normalizeDate(updated.createdAt),
    };
  }

  async deleteLongTermMemoryBySession(sessionId: string): Promise<boolean> {
    const result = await db
      .delete(longTermMemory)
      .where(eq(longTermMemory.sessionId, sessionId));
    return (result.rowCount || 0) > 0;
  }

  async aggregateAndCompressMemory(
    sessionId: string,
  ): Promise<LongTermMemory[]> {
    // Load raw learning data for this session
    const rawData = await this.getLearningData(sessionId);
    if (rawData.length === 0) return this.getLongTermMemory(sessionId, 1000);

    // CASCADE PREVENTION: Wipe existing LTM before re-aggregating so we never
    // stack duplicate entries from repeated compression cycles (same O(n²) bug as MemStorage).
    await this.deleteLongTermMemoryBySession(sessionId);

    const typeGroups = new Map<string, LearningData[]>();
    for (const item of rawData) {
      if (!typeGroups.has(item.patternType))
        typeGroups.set(item.patternType, []);
      typeGroups.get(item.patternType)!.push(item);
    }

    const compressed: LongTermMemory[] = [];

    for (const [patternType, patterns] of typeGroups) {
      const totalWeight = patterns.reduce((sum, p) => sum + p.weight, 0);
      const occurrences = patterns.length;
      if (occurrences < 3 && totalWeight < 2.0) continue;

      const combined = patterns.map((p) => p.patternData).join("|");
      let hash = 0;
      for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash = hash & hash;
      }
      const semanticHash = Math.abs(hash).toString(16);
      const confidenceScore = Math.max(
        0,
        Math.min(1.0, totalWeight / (occurrences * 5)),
      );

      const summaryMap: Record<string, string> = {
        writing_style: `User prefers ${occurrences} specific writing patterns`,
        mode_preference: `User favors modes used in ${occurrences} recent interactions`,
        topic_interest: `User shows sustained interest across ${occurrences} topic areas`,
        story_element: `${occurrences} story elements captured from session`,
        narrative_theme: `${occurrences} narrative themes identified`,
        character_detail: `${occurrences} character details learned`,
        plot_point: `${occurrences} plot points observed`,
        feedback: `${occurrences} feedback signals recorded`,
      };
      const summary =
        summaryMap[patternType] ??
        `Aggregated pattern from ${occurrences} observations`;

      const memTypeMap: Record<string, string> = {
        writing_style: "writing_signature",
        mode_preference: "behavioral_trend",
        topic_interest: "thematic_preference",
        story_element: "semantic_cluster",
        narrative_theme: "thematic_preference",
        character_detail: "user_pattern",
        plot_point: "semantic_cluster",
        feedback: "user_pattern",
      };
      const memoryType = (memTypeMap[patternType] ??
        "user_pattern") as LongTermMemory["memoryType"];

      const mem = await this.createLongTermMemory({
        sessionId,
        memoryType,
        summary,
        semanticHash,
        occurrences,
        totalWeight,
        relatedPatterns: patterns.map((p) => p.id),
        confidenceScore,
        tokenEstimate: occurrences * 150,
      });
      compressed.push(mem);
    }

    // POISON PREVENTION: Delete raw learning data now that it's compressed.
    // Prevents re-reading the same data on the next compression cycle.
    await this.deleteLearningDataBySession(sessionId);

    return compressed;
  }

  // Deletion Requests
  async getDeletionRequest(id: string): Promise<DeletionRequest | undefined> {
    const result = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, id))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      requestedAt: normalizeDate(result[0].requestedAt),
      completedAt: normalizeDateOrUndefined(result[0].completedAt),
    };
  }

  async getDeletionRequestBySession(
    sessionId: string,
  ): Promise<DeletionRequest | undefined> {
    const result = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.sessionId, sessionId))
      .orderBy(desc(deletionRequests.requestedAt))
      .limit(1);
    if (!result[0]) return undefined;
    return {
      ...result[0],
      requestedAt: normalizeDate(result[0].requestedAt),
      completedAt: normalizeDateOrUndefined(result[0].completedAt),
    };
  }

  async listAllDeletionRequests(): Promise<DeletionRequest[]> {
    const result = await db
      .select()
      .from(deletionRequests)
      .orderBy(desc(deletionRequests.requestedAt));
    return result.map((r: typeof deletionRequests.$inferSelect) => ({
      ...r,
      requestedAt: normalizeDate(r.requestedAt),
      completedAt: normalizeDateOrUndefined(r.completedAt),
    }));
  }

  async createDeletionRequest(
    request: InsertDeletionRequest,
  ): Promise<DeletionRequest> {
    const id = randomUUID();
    const [newRequest] = await db
      .insert(deletionRequests)
      .values({
        ...request,
        id,
      })
      .returning();
    return {
      ...newRequest,
      requestedAt: normalizeDate(newRequest.requestedAt),
      completedAt: normalizeDateOrUndefined(newRequest.completedAt),
    };
  }

  async updateDeletionRequest(
    id: string,
    updates: Partial<DeletionRequest>,
  ): Promise<DeletionRequest | undefined> {
    const updateData: any = { ...updates };
    if (updateData.requestedAt) {
      updateData.requestedAt = new Date(updateData.requestedAt);
    }
    if (updateData.completedAt) {
      updateData.completedAt = new Date(updateData.completedAt);
    }
    const [updated] = await db
      .update(deletionRequests)
      .set(updateData)
      .where(eq(deletionRequests.id, id))
      .returning();
    if (!updated) return undefined;
    return {
      ...updated,
      requestedAt: normalizeDate(updated.requestedAt),
      completedAt: normalizeDateOrUndefined(updated.completedAt),
    };
  }

  // Privacy operations
  async deleteAllUserData(sessionId: string): Promise<boolean> {
    // ANTI-CASCADE PROTOCOL: Delete user interaction data only.
    // Keep the session record and consent log for audit purposes,
    // while removing conversations, messages, and deletion requests.
    await db.delete(messages).where(eq(messages.sessionId, sessionId));
    await db
      .delete(conversations)
      .where(eq(conversations.sessionId, sessionId));
    await db
      .delete(deletionRequests)
      .where(eq(deletionRequests.sessionId, sessionId));

    return true;
  }

  async purgeExpiredSessions(daysOld: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    // Implements the "30 rolling days from last interaction" policy accurately.
    // A session is expired only when COALESCE(last conversation activity, session creation) < cutoff.
    // If a user was active yesterday, their session is NOT purged even if the session was created 31+ days ago.
    // Consent and learning/memory data survive through ON DELETE SET NULL on their session FK.
    const rawRows = await db.execute(sql`
      SELECT s.id
      FROM sessions s
      LEFT JOIN conversations c ON c.session_id = s.id
      WHERE s.created_at < ${cutoff}
      GROUP BY s.id, s.created_at
      HAVING COALESCE(MAX(c.updated_at), s.created_at) < ${cutoff}
    `);
    const expired: { id: string }[] = Array.isArray(rawRows)
      ? (rawRows as unknown as { id: string }[])
      : ((rawRows as unknown as { rows: { id: string }[] }).rows ?? []);

    for (const { id } of expired) {
      await db.delete(sessions).where(eq(sessions.id, id));
    }

    return expired.length;
  }

  async purgeExpiredConsents(monthsOld: number): Promise<number> {
    // Consent records are retained for a MINIMUM of monthsOld months for legal audit purposes.
    // This job deletes them only after that window has passed.
    const cutoff = new Date(Date.now() - monthsOld * 30 * 24 * 60 * 60 * 1000);
    const expired = await db
      .select({ id: consent.id })
      .from(consent)
      .where(sql`${consent.consentDate} < ${cutoff}`);
    for (const { id } of expired) {
      await db.delete(consent).where(eq(consent.id, id));
    }
    return expired.length;
  }

  async exportUserData(sessionId: string): Promise<object> {
    const session = await this.getSession(sessionId);
    const messages = await this.getMessages(sessionId);
    const conversations = await this.getConversationsBySession(sessionId);
    const learning = await this.getLearningData(sessionId);
    const memories = await this.getLongTermMemory(sessionId);
    const consentData = await this.getConsent(sessionId);

    return {
      session,
      messages,
      conversations,
      learningData: learning,
      longTermMemory: memories,
      consent: consentData,
      exportDate: new Date().toISOString(),
    };
  }

  async clearSessionMessages(sessionId: string): Promise<boolean> {
    await db.delete(messages).where(eq(messages.sessionId, sessionId));
    return true;
  }

  // Rate limiting & spam detection
  async checkRateLimit(
    sessionId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Allow up to 60 messages per 5-minute window (30 back-and-forth exchanges)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentMessages = await db
      .select()
      .from(messages)
      .where(
        sql`${messages.sessionId} = ${sessionId} AND ${messages.timestamp} > ${fiveMinutesAgo}`,
      );

    if (recentMessages.length >= 60) {
      return {
        allowed: false,
        reason: "Too many messages — please wait a moment before sending more.",
      };
    }

    return { allowed: true };
  }
}

export const storage = process.env.DATABASE_URL
  ? new PgStorage()
  : new MemStorage();
console.log(
  "[STORAGE] Selected storage backend:",
  process.env.DATABASE_URL
    ? "PgStorage (PostgreSQL)"
    : "MemStorage (in-memory)",
);
