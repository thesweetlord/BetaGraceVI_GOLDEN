import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { apiRequest } from "./queryClient"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface WebSearchResult {
  success: boolean;
  query: string;
  source: string;
  evidence: string;
  error?: string;
}

/**
 * Perform a web search using the backend's multi-provider search engine.
 * 
 * @param query - The search query string
 * @param provider - Optional: "bing" or "duckduckgo" for single provider, or undefined for both
 * @returns Promise<WebSearchResult> with search results or error details
 * 
 * @example
 * ```typescript
 * const result = await performWebSearch("latest TypeScript features");
 * if (result.success) {
 *   console.log("Evidence:", result.evidence);
 *   console.log("Source:", result.source); // "bing+duckduckgo"
 * } else {
 *   console.error("Search failed:", result.error);
 * }
 * 
 * // Single provider search
 * const bingResult = await performWebSearch("React hooks", "bing");
 * ```
 */
export async function performWebSearch(
  query: string,
  provider?: "bing" | "duckduckgo"
): Promise<WebSearchResult> {
  try {
    const body: { query: string; provider?: string } = { query };
    if (provider) {
      body.provider = provider;
    }

    const res = await apiRequest("POST", "/api/web-search", body);
    const data = await res.json();

    if (!data.success) {
      return {
        success: false,
        query,
        source: provider || "unknown",
        evidence: "",
        error: data.error || "Web search failed",
      };
    }

    return {
      success: true,
      query: data.query,
      source: data.source,
      evidence: data.evidence,
    };
  } catch (error) {
    return {
      success: false,
      query,
      source: provider || "unknown",
      evidence: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
