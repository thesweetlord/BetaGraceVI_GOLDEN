/**
 * Image metrics cache to reduce redundant image analysis
 * Stores computed metrics for previously analyzed images
 */

import { createHash } from 'crypto';

interface ImageMetrics {
  colorDensity: number;
  contrast: number;
  complexity: number;
  brightness: number;
  dominantColorCount: number;
}

interface CachedMetrics {
  metrics: ImageMetrics;
  timestamp: number;
}

class ImageMetricsCache {
  private cache = new Map<string, CachedMetrics>();
  private readonly maxCacheSize = 1000;
  private readonly cacheTTL = 30 * 60 * 1000; // 30 minutes

  private generateCacheKey(imageUrl: string, style: string): string {
    const hash = createHash('sha256')
      .update(imageUrl + style)
      .digest('hex')
      .substring(0, 16);
    return `${hash}`;
  }

  get(imageUrl: string, style: string): ImageMetrics | null {
    const key = this.generateCacheKey(imageUrl, style);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.metrics;
  }

  set(imageUrl: string, style: string, metrics: ImageMetrics): void {
    const key = this.generateCacheKey(imageUrl, style);

    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      metrics,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getSize(): number {
    return this.cache.size;
  }
}

export const imageMetricsCache = new ImageMetricsCache();
