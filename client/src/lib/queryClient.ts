import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getSessionIdFromStore(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('betagrace-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      const sessionId = parsed?.state?.sessionId;
      if (sessionId) return sessionId;
    }
  } catch (e) {
    // Silently handle localStorage errors
  }

  try {
    const legacyId = localStorage.getItem('betagrace-sessionId');
    if (legacyId) return legacyId;
  } catch (e) {
    // Silently handle localStorage errors
  }

  return null;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  
  // CRITICAL: Add X-Session-ID header for persistent session tracking
  const sessionId = getSessionIdFromStore();
  if (sessionId) {
    headers["X-Session-ID"] = sessionId;
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    
    // CRITICAL: Add X-Session-ID header for persistent session tracking
    const sessionId = getSessionIdFromStore();
    if (sessionId) {
      headers["X-Session-ID"] = sessionId;
    }
    
    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
