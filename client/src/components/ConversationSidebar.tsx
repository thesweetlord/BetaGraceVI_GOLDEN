import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  MessageSquare,
  Trash2,
  Loader2,
  Clock,
  PlusCircle,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { AIMode, Message } from "@shared/schema";
import { MODE_COLORS } from "@/lib/constants";

interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  activeModes: AIMode[];
  createdAt: string;
  updatedAt: string;
}

interface HistoryResponse {
  success: boolean;
  sessionId: string;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  messages: Message[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationSidebar() {
  const {
    sessionId,
    currentConversationId,
    setCurrentConversationId,
    setMessages,
    clearMessages,
    primaryMode,
  } = useAppStore();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ["conversationHistory", sessionId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/session/history");
      return res.json();
    },
    enabled: Boolean(sessionId),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/conversation/${id}`);
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: ["conversationHistory", sessionId],
      });
      if (currentConversationId === id) {
        clearMessages();
        setCurrentConversationId(null);
      }
      toast({ title: "Conversation deleted" });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete conversation.",
        variant: "destructive",
      });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await apiRequest("PUT", `/api/conversation/${id}/rename`, {
        title,
      });
      if (!res.ok) throw new Error("Rename failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["conversationHistory", sessionId],
      });
      setRenamingId(null);
      setRenameValue("");
      toast({ title: "Conversation renamed" });
    },
    onError: () => {
      toast({
        title: "Rename failed",
        description: "Could not rename conversation.",
        variant: "destructive",
      });
    },
  });

  const startRename = useCallback(
    (conv: ConversationSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingId(conv.id);
      setRenameValue(conv.title || "");
      setTimeout(() => renameInputRef.current?.focus(), 50);
    },
    [],
  );

  const commitRename = useCallback(
    (id: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      renameMutation.mutate({ id, title: trimmed });
    },
    [renameValue, renameMutation],
  );

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  const loadConversation = useCallback(
    async (conv: ConversationSummary) => {
      console.log("LOAD CONVERSATION CLICKED", conv.id);
      if (loadingId === conv.id) return;
      if (renamingId === conv.id) return;
      setLoadingId(conv.id);
      try {
        const res = await apiRequest(
          "GET",
          `/api/conversation/${conv.id}/messages`,
        );
        if (res.status === 404) {
          setMessages([]);
          setCurrentConversationId(conv.id);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const payload = (await res.json()) as { messages: Message[] };
        console.log("PAYLOAD", payload);
        setMessages(payload.messages ?? []);
        setCurrentConversationId(conv.id);
      } catch {
        toast({
          title: "Error",
          description: "Could not load conversation.",
          variant: "destructive",
        });
      } finally {
        setLoadingId(null);
      }
    },
    [loadingId, renamingId, setMessages, setCurrentConversationId, toast],
  );
  const handleNewChat = () => {
    clearMessages();
    setCurrentConversationId(null);
    queryClient.invalidateQueries({
      queryKey: ["conversationHistory", sessionId],
    });
  };

  const conversations = data?.conversations ?? [];
  const modeColors = MODE_COLORS[primaryMode] ?? MODE_COLORS.standard;

  return (
    <>
      {/* New Chat */}
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <button
                type="button"
                onClick={handleNewChat}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                data-testid="button-new-chat"
              >
                <PlusCircle className="w-4 h-4 shrink-0" />
                <span>New Conversation</span>
              </button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Conversation History */}
      <SidebarGroup className="flex-1 min-h-0">
        <SidebarGroupLabel className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Recent Conversations
          {conversations.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-[9px] h-4 px-1">
              {conversations.length}
            </Badge>
          )}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading history…
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              No past conversations yet. Start chatting to build your history.
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-340px)] overflow-y-auto">
              <div className="space-y-0.5 pr-1">
                {conversations.map((conv) => {
                  const isActive = currentConversationId === conv.id;
                  const isThisLoading = loadingId === conv.id;
                  const isRenaming = renamingId === conv.id;
                  const primaryConvMode = (conv.activeModes?.[0] ??
                    "standard") as AIMode;
                  const colors =
                    MODE_COLORS[primaryConvMode] ?? MODE_COLORS.standard;

                  return (
                    <div
                      key={conv.id}
                      className={cn(
                        "group relative flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent transition-colors",
                        isActive && "bg-accent ring-1 ring-primary/20",
                      )}
                      onClick={() => !isRenaming && loadConversation(conv)}
                      data-testid={`conversation-item-${conv.id}`}
                    >
                      {/* Mode color dot */}
                      <div
                        className={cn(
                          "mt-0.5 w-2 h-2 rounded-full shrink-0 mt-1.5",
                          colors.accent,
                        )}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          {isRenaming ? (
                            <div
                              className="flex items-center gap-1 flex-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitRename(conv.id);
                                  }
                                  if (e.key === "Escape") cancelRename();
                                }}
                                className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                data-testid={`input-rename-${conv.id}`}
                              />
                              <button
                                type="button"
                                className="p-0.5 rounded text-green-600 hover:text-green-700 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  commitRename(conv.id);
                                }}
                                disabled={renameMutation.isPending}
                                title="Save"
                              >
                                {renameMutation.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelRename();
                                }}
                                title="Cancel"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p
                                className={cn(
                                  "text-xs font-medium leading-tight line-clamp-2 flex-1",
                                  isActive
                                    ? "text-foreground"
                                    : "text-foreground/80",
                                )}
                              >
                                {isThisLoading ? (
                                  <span className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin inline" />
                                    Loading…
                                  </span>
                                ) : (
                                  conv.title || "Untitled conversation"
                                )}
                              </p>
                              <div className="flex items-center shrink-0 gap-0.5">
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 hover:text-primary transition-all p-0.5 rounded"
                                  onClick={(e) => startRename(conv, e)}
                                  title="Rename conversation"
                                  data-testid={`button-rename-conv-${conv.id}`}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all p-0.5 rounded"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteMutation.mutate(conv.id);
                                  }}
                                  disabled={deleteMutation.isPending}
                                  title="Delete conversation"
                                  data-testid={`button-delete-conv-${conv.id}`}
                                >
                                  {deleteMutation.isPending &&
                                  deleteMutation.variables === conv.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        {!isRenaming && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {relativeTime(conv.updatedAt)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              ·
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <MessageSquare className="w-2.5 h-2.5" />
                              {conv.messageCount}
                            </span>
                            {conv.activeModes?.length > 0 && (
                              <>
                                <span className="text-[10px] text-muted-foreground">
                                  ·
                                </span>
                                <span
                                  className={cn(
                                    "text-[9px] font-medium capitalize",
                                    colors.text,
                                  )}
                                >
                                  {String(conv.activeModes[0]).replace(
                                    /_/g,
                                    " ",
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
