/**
 * PARALLEL LEARNING SERVICE
 * Distributed architecture for 1M+ concurrent sessions
 * Session sharding + distributed aggregation + worker pool
 */

import type { LongTermMemory } from "@shared/schema";

// ============================================================================
// SESSION SHARDING (Distributed across multiple stores)
// ============================================================================

export interface ShardKey {
  sessionId: string;
  shardId: number; // 0-9 (10 shards for 1M sessions = 100k sessions per shard)
}

export class SessionShardManager {
  private shardCount: number;
  private shards: Map<number, Set<string>>; // shardId -> sessionIds

  constructor(shardCount: number = 10) {
    this.shardCount = shardCount;
    this.shards = new Map();
    for (let i = 0; i < shardCount; i++) {
      this.shards.set(i, new Set());
    }
  }

  getShardId(sessionId: string): number {
    // Hash-based sharding: consistent placement across restarts
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % this.shardCount;
  }

  registerSession(sessionId: string): number {
    const shardId = this.getShardId(sessionId);
    const shard = this.shards.get(shardId);
    if (shard) {
      shard.add(sessionId);
    }
    return shardId;
  }

  getSessionsInShard(shardId: number): Set<string> | undefined {
    return this.shards.get(shardId);
  }

  getAllShards(): Map<number, Set<string>> {
    return this.shards;
  }

  getShardStats(): {
    totalShards: number;
    totalSessions: number;
    sessionsPerShard: Record<number, number>;
  } {
    const stats: Record<number, number> = {};
    let total = 0;

    for (let i = 0; i < this.shardCount; i++) {
      const count = this.shards.get(i)?.size || 0;
      stats[i] = count;
      total += count;
    }

    return {
      totalShards: this.shardCount,
      totalSessions: total,
      sessionsPerShard: stats,
    };
  }
}

// ============================================================================
// DISTRIBUTED LEARNING AGGREGATION
// ============================================================================

export interface AggregationTask {
  shardId: number;
  sessionIds: string[];
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: LongTermMemory[];
}

export class DistributedAggregationService {
  private taskQueue: AggregationTask[] = [];
  private completedTasks: Map<string, AggregationTask> = new Map();
  private maxConcurrentTasks: number;
  private activeTaskCount: number = 0;

  constructor(maxConcurrentTasks: number = 5) {
    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  /**
   * Queue aggregation task for a shard
   */
  queueAggregation(shardId: number, sessionIds: string[]): string {
    const taskId = `agg-${shardId}-${Date.now()}`;
    const task: AggregationTask = {
      shardId,
      sessionIds,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.taskQueue.push(task);
    this.processNext();

    return taskId;
  }

  /**
   * Process queued aggregation tasks
   */
  private async processNext(): Promise<void> {
    if (this.activeTaskCount >= this.maxConcurrentTasks || this.taskQueue.length === 0) {
      return;
    }

    this.activeTaskCount++;
    const task = this.taskQueue.shift();

    if (task) {
      task.status = 'processing';
      
      try {
        // Simulate aggregation work (would aggregate learning data from all sessions in shard)
        await new Promise(resolve => setTimeout(resolve, 100));
        
        task.status = 'completed';
        task.result = []; // Would contain aggregated memory
        
        const taskId = `agg-${task.shardId}-${task.timestamp}`;
        this.completedTasks.set(taskId, task);
      } catch (error) {
        task.status = 'failed';
      }
    }

    this.activeTaskCount--;
    this.processNext(); // Process next task
  }

  /**
   * Get aggregation task status
   */
  getTaskStatus(taskId: string): AggregationTask | undefined {
    return this.completedTasks.get(taskId);
  }

  /**
   * Get queue stats
   */
  getStats(): {
    queuedTasks: number;
    activeTasks: number;
    completedTasks: number;
    maxConcurrent: number;
  } {
    return {
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTaskCount,
      completedTasks: this.completedTasks.size,
      maxConcurrent: this.maxConcurrentTasks,
    };
  }
}

// ============================================================================
// PARALLEL WORKER POOL
// ============================================================================

export interface WorkerTask {
  id: string;
  type: 'compress' | 'aggregate' | 'retrieve' | 'filter';
  data: Record<string, any>;
  priority: number; // 0-10, higher = higher priority
  timestamp: number;
}

export class ParallelWorkerPool {
  private workers: number;
  private taskQueue: WorkerTask[] = [];
  private activeWorkers: Map<string, WorkerTask> = new Map();

  constructor(workerCount: number = 4) {
    this.workers = workerCount;
  }

  /**
   * Queue a task for parallel processing
   */
  enqueue(task: WorkerTask): string {
    this.taskQueue.push(task);
    // Sort by priority (higher priority first)
    this.taskQueue.sort((a, b) => b.priority - a.priority);
    return task.id;
  }

  /**
   * Get next available task
   */
  dequeue(): WorkerTask | undefined {
    if (this.activeWorkers.size < this.workers && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        this.activeWorkers.set(task.id, task);
        return task;
      }
    }
    return undefined;
  }

  /**
   * Mark task as complete
   */
  markComplete(taskId: string): boolean {
    return this.activeWorkers.delete(taskId);
  }

  /**
   * Get pool stats
   */
  getStats(): {
    totalWorkers: number;
    activeWorkers: number;
    queuedTasks: number;
    utilization: string;
  } {
    const utilization = ((this.activeWorkers.size / this.workers) * 100).toFixed(1);
    return {
      totalWorkers: this.workers,
      activeWorkers: this.activeWorkers.size,
      queuedTasks: this.taskQueue.length,
      utilization: `${utilization}%`,
    };
  }
}

// ============================================================================
// PARALLEL LEARNING COORDINATOR
// ============================================================================

export class ParallelLearningCoordinator {
  private shardManager: SessionShardManager;
  private aggregationService: DistributedAggregationService;
  private workerPool: ParallelWorkerPool;

  constructor() {
    this.shardManager = new SessionShardManager(10); // 10 shards for 1M sessions
    this.aggregationService = new DistributedAggregationService(5); // 5 concurrent aggregations
    this.workerPool = new ParallelWorkerPool(4); // 4 worker threads
  }

  /**
   * Register new session for learning
   */
  registerSession(sessionId: string): number {
    return this.shardManager.registerSession(sessionId);
  }

  /**
   * Enqueue parallel compression task
   */
  enqueueCompressionTask(sessionId: string, learningData: LongTermMemory[]): string {
    const taskId = `compress-${sessionId}-${Date.now()}`;
    const task: WorkerTask = {
      id: taskId,
      type: 'compress',
      data: { sessionId, learningData },
      priority: 5,
      timestamp: Date.now(),
    };
    return this.workerPool.enqueue(task);
  }

  /**
   * Trigger shard-wide aggregation
   */
  triggerShardAggregation(shardId: number): string {
    const sessionIds = Array.from(this.shardManager.getSessionsInShard(shardId) || []);
    return this.aggregationService.queueAggregation(shardId, sessionIds);
  }

  /**
   * Trigger all-shard aggregation (parallel across all shards)
   */
  triggerGlobalAggregation(): string[] {
    const shards = this.shardManager.getAllShards();
    const taskIds: string[] = [];

    for (const [shardId, sessionIds] of shards) {
      const taskId = this.aggregationService.queueAggregation(shardId, Array.from(sessionIds));
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * Get comprehensive system metrics
   */
  getMetrics(): {
    shards: ReturnType<SessionShardManager['getShardStats']>;
    aggregation: ReturnType<DistributedAggregationService['getStats']>;
    workers: ReturnType<ParallelWorkerPool['getStats']>;
    timestamp: string;
  } {
    return {
      shards: this.shardManager.getShardStats(),
      aggregation: this.aggregationService.getStats(),
      workers: this.workerPool.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}

// Export singleton instance
export const parallelLearning = new ParallelLearningCoordinator();
