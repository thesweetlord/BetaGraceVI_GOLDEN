import { useState, useRef, useEffect } from "react";
import ArtifactHistoryPanel from "@/components/ArtifactHistoryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Send, 
  Loader2, 
  Sparkles, 
  User, 
  Copy, 
  Check,
  RotateCcw,
  Trash2,
  Image as ImageIcon,
  Video,
  Download,
  ChevronDown,
  Zap,
  Cross,
  Brain,
  Terminal,
  Play,
  Shield,
  Wrench,
  Globe,
  Search,
  X,
  AlertTriangle,
  Lock,
  Upload,
  Network,
  BookOpen,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { CodeGraphPanel, type CodeGraph } from "./CodeGraphPanel";
import { ArtifactProgressCard } from "./ArtifactProgressCard";
import { useAppStore } from "@/lib/store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { MODE_METADATA, type AIMode, type Message, type ChatResponse } from "@shared/schema";
import { MODE_COLORS, ART_STYLES, type ArtStyle } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateUUID } from "@/lib/uuid";

// ── Auto-playing slideshow that presents a storyboard as a video experience ──
function StoryboardPlayer({ frames, captions, onClear }: { frames: string[]; captions?: string[]; onClear: () => void }) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false); // start paused until first frame loads
  const [loadedFrames, setLoadedFrames] = useState<Set<number>>(new Set());
  const [failedFrames, setFailedFrames] = useState<Set<number>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLoadedFrames(new Set());
    setFailedFrames(new Set());
    setCurrentFrame(0);
    setPlaying(false);
  }, [frames]);

  const loadedFrameIndices = Array.from(loadedFrames).sort((a, b) => a - b);
  const failedCount = failedFrames.size;
  const loadedCount = loadedFrames.size;
  const firstFrameReady = loadedFrameIndices.length > 0;
  const firstLoadedIndex = loadedFrameIndices[0] ?? 0;
  const isFullyFailed = failedCount === frames.length;

  const getNextLoadedFrame = (start: number) => {
    if (loadedFrameIndices.length === 0) return start;
    const total = frames.length;
    for (let offset = 1; offset < total; offset++) {
      const idx = (start + offset) % total;
      if (loadedFrames.has(idx)) return idx;
    }
    return loadedFrames.has(start) ? start : firstLoadedIndex;
  };

  const markLoaded = (idx: number) => {
    setLoadedFrames(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const markFailed = (idx: number) => {
    setFailedFrames(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    setLoadedFrames(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  // Auto-start playback once any frame is ready
  useEffect(() => {
    if (firstFrameReady && !playing) {
      setCurrentFrame(firstLoadedIndex);
      setPlaying(true);
    }
  }, [firstFrameReady, firstLoadedIndex, playing]);

  useEffect(() => {
    if (playing && firstFrameReady) {
      intervalRef.current = setInterval(() => {
        setCurrentFrame(prev => getNextLoadedFrame(prev));
      }, 2400);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, firstFrameReady, loadedFrameIndices.length, frames.length]);

  const goTo = (idx: number) => {
    if (loadedFrames.has(idx)) {
      setCurrentFrame(idx);
      setPlaying(false);
    }
  };

  return (
    <div className="flex gap-3">
      <Avatar className="w-8 h-8 shrink-0">
        <AvatarFallback className="bg-rose-500/20 text-rose-500">
          <Video className="w-4 h-4" />
        </AvatarFallback>
      </Avatar>
      <Card className="bg-muted/50 max-w-[90%] border-rose-500/20" data-testid="storyboard-player">
        <CardContent className="p-3 space-y-2">
          <div className="text-xs font-semibold text-rose-500 flex items-center gap-2">
            <Video className="w-3 h-3" />
            AI Cinematic Video
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              {firstFrameReady ? `${currentFrame + 1} / ${frames.length}` : `Loading ${loadedCount}/${frames.length}…`}
            </span>
          </div>

          {/* Main viewport */}
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video w-full">
            {frames.map((url, idx) => (
              <img
                key={`slide-${idx}`}
                src={url}
                alt={`Frame ${idx + 1}`}
                className={cn(
                  "absolute inset-0 w-full h-full object-cover transition-opacity duration-700",
                  idx === currentFrame && loadedFrames.has(idx) ? "opacity-100" : "opacity-0"
                )}
                onLoad={() => markLoaded(idx)}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  markFailed(idx);
                }}
              />
            ))}

            {/* Caption overlay — cinematic letterbox style */}
            {firstFrameReady && captions && captions[currentFrame] && (
              <div className="absolute bottom-0 left-0 right-0 pb-3 pt-6 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                <p className="text-center text-white text-[11px] font-light tracking-wide px-3 drop-shadow-lg line-clamp-2">
                  {captions[currentFrame]}
                </p>
              </div>
            )}

            {/* Loading overlay — shown until first frame is ready or if all frames fail */}
            {!firstFrameReady && !isFullyFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80">
                <Loader2 className="w-6 h-6 text-rose-400 animate-spin" />
                <span className="text-[11px] text-rose-300">
                  Composing scene {loadedCount + 1} of {frames.length}…
                </span>
                {failedCount > 0 && (
                  <span className="text-[10px] text-rose-300 opacity-80">
                    {failedCount} frame{failedCount === 1 ? '' : 's'} failed to load, continuing with available scenes.
                  </span>
                )}
                <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all duration-500 rounded-full"
                    style={{ width: `${(loadedCount / frames.length) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {isFullyFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center px-4">
                <span className="text-sm font-semibold text-rose-400">Storyboard failed to load</span>
                <p className="text-[11px] text-rose-200 max-w-xs">
                  All storyboard frames failed to load. Please try generating the video again or refresh the page.
                </p>
              </div>
            )}

            {/* Play/Pause overlay — only when frames are loaded */}
            {firstFrameReady && !isFullyFailed && (
              <button
                className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
                onClick={() => setPlaying(p => !p)}
                data-testid="button-storyboard-playpause"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-2">
                  {playing
                    ? <div className="w-4 h-4 flex gap-1 items-center justify-center"><div className="w-1 h-4 bg-white rounded"/><div className="w-1 h-4 bg-white rounded"/></div>
                    : <div className="w-0 h-0 border-y-8 border-y-transparent border-l-[14px] border-l-white ml-1"/>
                  }
                </div>
              </button>
            )}

            {/* Progress bar */}
            {firstFrameReady && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/30">
                <div
                  className="h-full bg-rose-500 transition-all duration-200"
                  style={{ width: `${((currentFrame + 1) / frames.length) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* Frame scrubber thumbnails */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {frames.map((url, idx) => (
              <button
                key={`thumb-${idx}`}
                onClick={() => goTo(idx)}
                disabled={!loadedFrames.has(idx)}
                className={cn(
                  "shrink-0 w-12 aspect-video rounded overflow-hidden border-2 transition-colors relative bg-black/30",
                  idx === currentFrame ? "border-rose-500" : "border-transparent opacity-60 hover:opacity-100",
                  !loadedFrames.has(idx) && "cursor-not-allowed"
                )}
                data-testid={`button-frame-${idx}`}
              >
                <img src={url} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" />
                {!loadedFrames.has(idx) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-7 text-[11px]"
              onClick={() => setPlaying(p => !p)}
              disabled={!firstFrameReady}
              data-testid="button-storyboard-toggle"
            >
              {firstFrameReady ? (playing ? "Pause" : "Play") : "Loading…"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-7 text-[11px]"
              onClick={onClear}
              data-testid="button-storyboard-clear"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ChatInterface() {
  const { 
    primaryMode, 
    activeModes, 
    messages, 
    addMessage, 
    clearMessages,
    setMessages,
    updateMessageContent,
    rollbackToMessage,
    currentConversationId,
    setCurrentConversationId,
    sessionId,
    learningEnabled,
    generatedImage,
    setGeneratedImage,
    generatedVideo,
    setGeneratedVideo,
    generatedStoryboard,
    setGeneratedStoryboard,
    generatedStoryboardCaptions,
    setGeneratedStoryboardCaptions,
    baseImagePrompt,
    setBaseImagePrompt,
    advancedReasoningEnabled,
    setAdvancedReasoningEnabled,
    faithEnhancementEnabled,
    setFaithEnhancementEnabled,
    textModel,
    setTextModel,
    imageModel,
    setImageModel,
  } = useAppStore();
  
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [selectedStyles, setSelectedStyles] = useState<ArtStyle[]>([ART_STYLES[0]]);
  const MAX_STYLES = 3;
  const [devSandboxOpen, setDevSandboxOpen] = useState(false);
  const [sandboxInput, setSandboxInput] = useState('');
  const [sandboxOutput, setSandboxOutput] = useState('');
  const [selfMendOpen, setSelfMendOpen] = useState(false);
  const [selfMendPassword, setSelfMendPassword] = useState('');
  const [selfMendCode, setSelfMendCode] = useState('');
  const [selfMendIssue, setSelfMendIssue] = useState('');
  const [selfMendLang, setSelfMendLang] = useState('');
  const [selfMendOutput, setSelfMendOutput] = useState('');
  const [selfMendUnlocked, setSelfMendUnlocked] = useState(false);
  const [selfMendTargetFile, setSelfMendTargetFile] = useState('');

  // Code Graph state — active when code_graph mode is on
  const [codeGraph, setCodeGraph] = useState<CodeGraph | null>(null);
  const [codeGraphLoading, setCodeGraphLoading] = useState(false);

  // Reconnect state — tracks whether we are waiting for the server to come back
  const [reconnectState, setReconnectState] = useState<{
    active: boolean;
    attempt: number;
    max: number;
  } | null>(null);

  // Per-request token ceiling — sourced from persisted store (survives page reloads)
  const { maxTokens, setMaxTokens } = useAppStore();

  // Web search state
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchPanelOpen, setWebSearchPanelOpen] = useState(false);
  const [webSearchQuery, setWebSearchQuery] = useState('');
  const [webSearchResults, setWebSearchResults] = useState<{ query: string; results: string; source: string; timestamp: string } | null>(null);

  // Academic Artifact Builder state
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactTopic, setArtifactTopic] = useState('');
  const [artifactJobId, setArtifactJobId] = useState<string | null>(null);
  const [artifactResult, setArtifactResult] = useState<{
    topic: string;
    sectionsCompleted: number;
    totalSections: number;
    artifact: string;
    charCount: number;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasHydrated = useRef(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  type SessionHistoryResponse = {
    success: boolean;
    sessionId: string;
    conversations: Array<{
      id: string;
      title: string;
      messageCount: number;
      activeModes: AIMode[];
      createdAt: string;
      updatedAt: string;
    }>;
    activeConversationId: string | null;
    messages: Message[];
  };

  const historyQuery = useQuery<SessionHistoryResponse, Error, SessionHistoryResponse>({
    queryKey: ["sessionHistory", sessionId],
    queryFn: async (): Promise<SessionHistoryResponse> => {
      const response = await apiRequest("GET", "/api/session/history");
      return (await response.json()) as SessionHistoryResponse;
    },
    enabled: Boolean(sessionId),
  });

  useEffect(() => {
    if (historyQuery.isError) {
      console.error("[ChatInterface] Failed to restore history:", historyQuery.error);
    }
    // Only hydrate once on initial page load — never overwrite user-initiated
    // conversation switches or "New Chat" actions with cached data.
    if (hasHydrated.current) return;
    if (historyQuery.isSuccess && historyQuery.data) {
      const data = historyQuery.data as SessionHistoryResponse;
      if (!data.success) return;
      hasHydrated.current = true;
      console.log("[ChatInterface] session history hydrated (once)", {
        sessionId,
        activeConversationId: data.activeConversationId,
        messagesCount: data.messages?.length ?? 0,
      });
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
      }
      if (data.activeConversationId) {
        setCurrentConversationId(data.activeConversationId);
      }
    }
  }, [historyQuery.isSuccess, historyQuery.data, historyQuery.isError, historyQuery.error, sessionId, setCurrentConversationId, setMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, generatedImage]);

  // DEFENSIVE: Validate and fix message mode
  const getValidMode = (mode: any): AIMode => {
    if (!mode || !MODE_METADATA[mode as AIMode]) {
      console.warn('[ChatInterface] Invalid mode detected:', mode, '- defaulting to primaryMode');
      return primaryMode;
    }
    return mode as AIMode;
  };

  const imageMutation = useMutation({
    mutationFn: async (data: { prompt: string; styles: ArtStyle[] }) => {
      // Clean the base prompt (remove any existing style suffixes)
      let cleanPrompt = data.prompt;
      const stylePattern = /, in .+ style(s)?/g;
      cleanPrompt = cleanPrompt.replace(stylePattern, '');
      
      // Store base and apply provided styles (not from stale closure)
      setBaseImagePrompt(cleanPrompt);
      const response = await apiRequest('POST', '/api/generate-image', { 
        prompt: cleanPrompt,
        style: data.styles[0] || 'auto' // Send first style as single string
      });
      return await response.json();
    },
    onSuccess: (data) => {
      // SECURITY: Validate image URL before displaying
      const isValidImageUrl =
        typeof data.imageUrl === 'string' &&
        (data.imageUrl.startsWith('https://') ||
          data.imageUrl.startsWith('http://') ||
          data.imageUrl.startsWith('/api/images/') ||
          data.imageUrl.startsWith('/api/proxy-image'));

      if (!isValidImageUrl) {
        console.error('[ChatInterface] Invalid image URL:', data.imageUrl);
        toast({
          title: "Error",
          description: "Invalid image URL returned",
          variant: "destructive",
        });
        return;
      }
      
      console.log('[ChatInterface] Image generated successfully:', data.imageUrl);
      const freshImageUrl = data.imageUrl.includes('?')
        ? `${data.imageUrl}&v=${Date.now()}`
        : `${data.imageUrl}?v=${Date.now()}`;
      
      // CRITICAL: Clear old image and force re-render before setting new one
      setGeneratedImage(null);
      
      // Use setTimeout to ensure state clears before updating
      setTimeout(() => {
        // Display the generated image
        setGeneratedImage(freshImageUrl);
        
        toast({
          title: "Image Generated",
          description: "Your image has been created successfully.",
        });
        
        scrollToBottom();
      }, 50);
    },
    onError: (error) => {
      // SECURITY: Don't expose error details
      toast({
        title: "Error",
        description: "Failed to generate image. Please try again.",
        variant: "destructive",
      });
    },
  });

  // NO auto-regenerate - user must click "Regenerate with Styles" button to apply changes

  const videoMutation = useMutation({
    mutationFn: async (prompt: string): Promise<{ videoUrl: string | null; storyboard: string[] | null; captions: string[] | null }> => {
      toast({ title: "Generating Video...", description: "Composing your cinematic scene…" });

      const queueResp = await apiRequest('POST', '/api/generate-video', { prompt, style: 'cinematic', sceneCount: 20, mode: primaryMode });
      if (!queueResp.ok) {
        const err = await queueResp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to queue video');
      }
      const { jobId } = await queueResp.json() as { jobId: string };

      // Poll every 5s — up to 25 minutes for video completion
      let storyboardShown = false;
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusResp = await fetch(`/api/video-status/${jobId}`);
        if (!statusResp.ok) continue;
        const job = await statusResp.json() as {
          status: string;
          videoUrl?: string | null;
          storyboard?: string[];
          storyboardCaptions?: string[];
          error?: string;
        };
        // Show storyboard immediately as frames arrive, even while video is still rendering
        if (job.storyboard && job.storyboard.length > 0 && !storyboardShown) {
          storyboardShown = true;
          setGeneratedStoryboard(job.storyboard);
          setGeneratedStoryboardCaptions(job.storyboardCaptions ?? null);
          setGeneratedVideo(null);
          toast({ title: "Preview Ready!", description: "Storyboard frames loaded — full video rendering continues…" });
        }
        if (job.status === 'completed') {
          return { videoUrl: job.videoUrl ?? null, storyboard: job.storyboard ?? null, captions: job.storyboardCaptions ?? null };
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Video generation failed');
        }
      }
      throw new Error('Video generation timed out');
    },
    onSuccess: (data) => {
      if (data.videoUrl) {
        setGeneratedVideo(data.videoUrl);
        setGeneratedStoryboard(null);
        setGeneratedStoryboardCaptions(null);
        toast({ title: "Video Ready!", description: "Your cinematic video has been generated." });
      } else if (data.storyboard && data.storyboard.length > 0) {
        setGeneratedStoryboard(data.storyboard);
        setGeneratedStoryboardCaptions(data.captions);
        setGeneratedVideo(null);
        toast({ title: "Video Ready!", description: "Your cinematic scene is playing." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Video Error", description: error.message, variant: "destructive" });
    },
  });

  const sandboxMutation = useMutation({
    mutationFn: async ({ prompt, auditMode }: { prompt: string; auditMode?: boolean }) => {
      const resp = await apiRequest('POST', '/api/sandbox/run', { prompt, auditMode });
      if (!resp.ok) throw new Error('Sandbox request failed');
      return resp.json() as Promise<{ success: boolean; response: string; timestamp: string }>;
    },
    onSuccess: (data) => {
      setSandboxOutput(data.response);
    },
    onError: () => {
      toast({ title: "Sandbox Error", description: "Execution failed. Check server logs.", variant: "destructive" });
    },
  });

  const selfMendMutation = useMutation({
    mutationFn: async ({ password, code, issue, language }: { password: string; code: string; issue: string; language: string }) => {
      const resp = await apiRequest('POST', '/api/dev/self-mend', { password, code, issue, language });
      if (resp.status === 401) throw new Error('Invalid developer password');
      if (!resp.ok) throw new Error('Self-mend request failed');
      return resp.json() as Promise<{ success: boolean; analysis: string; provider: string; timestamp: string }>;
    },
    onSuccess: (data) => {
      setSelfMendOutput(data.analysis);
      toast({ title: "Self-Mend Complete", description: `Analysis done via ${data.provider}` });
    },
    onError: (err: Error) => {
      if (err.message.includes('password')) {
        toast({ title: "Access Denied", description: "Incorrect developer password.", variant: "destructive" });
      } else {
        toast({ title: "Self-Mend Error", description: err.message, variant: "destructive" });
      }
    },
  });

  const pushToCodeMutation = useMutation({
    mutationFn: async ({ filePath, code }: { filePath: string; code: string }) => {
      const resp = await apiRequest('POST', '/api/dev/push-to-code', {
        password: selfMendPassword,
        filePath,
        code,
      });
      if (resp.status === 401) throw new Error('Invalid developer password');
      if (resp.status === 403) throw new Error('File path not permitted');
      if (!resp.ok) throw new Error('Push to code failed');
      return resp.json() as Promise<{ success: boolean; filePath: string; bytesWritten: number; timestamp: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Code Pushed", description: `${data.bytesWritten.toLocaleString()} bytes written to ${data.filePath}` });
    },
    onError: (err: Error) => {
      toast({ title: "Push Failed", description: err.message, variant: "destructive" });
    },
  });

  const webSearchMutation = useMutation({
    mutationFn: async (query: string) => {
      const resp = await apiRequest('POST', '/api/web-search', { query });
      if (!resp.ok) throw new Error('Web search failed');
      return resp.json() as Promise<{ success: boolean; query: string; results: string; source: string; timestamp: string }>;
    },
    onSuccess: (data) => {
      setWebSearchResults({ query: data.query, results: data.results, source: data.source, timestamp: data.timestamp });
    },
    onError: () => {
      toast({ title: "Search Error", description: "Web search failed. Please try again.", variant: "destructive" });
    },
  });

  const handleWebSearch = () => {
    if (!webSearchQuery.trim()) return;
    webSearchMutation.mutate(webSearchQuery.trim());
  };

  // ── Academic Artifact Builder — background job + polling ────────────────────

  // Step 1: Start job (returns jobId in <1s, no proxy timeout risk)
  const artifactMutation = useMutation({
    mutationFn: async (topic: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionId) headers['X-Session-ID'] = sessionId;
      const resp = await fetch('/api/academic/artifact/build', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ topic }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Build failed' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }
      return resp.json() as Promise<{ success: boolean; jobId: string; status: string }>;
    },
    onSuccess: (data) => {
      setArtifactJobId(data.jobId);
    },
    onError: (err: Error) => {
      toast({ title: "Artifact Build Failed", description: err.message, variant: "destructive" });
    },
  });

  // Step 2: Poll every 3s while a jobId is active
  const { data: artifactPollData } = useQuery({
    queryKey: ['artifact-status', artifactJobId],
    queryFn: async () => {
      if (!artifactJobId) return null;
      const resp = await fetch(`/api/academic/artifact/status/${artifactJobId}`, { credentials: 'include' });
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      return resp.json() as Promise<{
        success: boolean;
        jobId: string;
        status: 'building' | 'complete' | 'error';
        topic: string;
        sectionsCompleted: number;
        totalSections: number;
        currentSection: string;
        artifact: string | null;
        charCount: number;
        error?: string;
      }>;
    },
    enabled: !!artifactJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      if (data.status === 'building') return 3000;
      return false;
    },
  });

  // Step 3: React to poll results
  useEffect(() => {
    if (!artifactPollData) return;
    if (artifactPollData.status === 'complete' && artifactPollData.artifact) {
      setArtifactResult({
        topic: artifactPollData.topic,
        sectionsCompleted: artifactPollData.sectionsCompleted,
        totalSections: artifactPollData.totalSections,
        artifact: artifactPollData.artifact,
        charCount: artifactPollData.charCount,
      });
      setArtifactJobId(null);
      toast({ title: "Artifact Ready", description: `${artifactPollData.sectionsCompleted} sections written — click Download to save.` });
    } else if (artifactPollData.status === 'error') {
      setArtifactJobId(null);
      toast({ title: "Artifact Build Failed", description: artifactPollData.error ?? 'Pipeline error', variant: "destructive" });
    }
  }, [artifactPollData]);

  const handleBuildArtifact = (topicOverride?: string) => {
    const topic = (topicOverride || artifactTopic).trim();
    if (!topic) return;
    setArtifactResult(null);
    setArtifactJobId(null);
    artifactMutation.mutate(topic);
  };

  const handleHistoryArtifactSelect = (content: string, topic: string) => {
    setArtifactResult({
      topic,
      sectionsCompleted: 0,
      totalSections: 0,
      artifact: content,
      charCount: content.length,
    });
    setArtifactJobId(null);
    setArtifactPanelOpen(true);
  };

  const handleDownloadArtifact = () => {
    if (!artifactResult?.artifact) return;
    const blob = new Blob([artifactResult.artifact], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `academic-paper-${artifactResult.topic.substring(0, 40).replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [isStreaming, setIsStreaming] = useState(false);

  // Iron Curtain — single global generation lock covering all async pipelines
  const isGenerating = isStreaming || imageMutation.isPending || videoMutation.isPending;

  // Extract the first code block from a self-mend analysis response
  const extractFixedCode = (output: string): string => {
    const match = output.match(/```[\w-]*\n([\s\S]*?)```/);
    return match ? match[1].trim() : '';
  };

  // Returns true when the server health endpoint responds OK (polls up to maxWaitMs)
  const waitForServer = async (maxWaitMs = 30000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch('/api/health/db', { signal: ctrl.signal });
        clearTimeout(tid);
        if (r.ok) return true;
      } catch {
        // server still down — keep polling
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    return false;
  };

  const isNetworkError = (e: unknown): boolean => {
    if (!(e instanceof Error)) return false;
    const msg = e.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||
      msg.includes('networkerror') ||
      msg.includes('fetch') ||
      e.name === 'TypeError'
    );
  };

  const sendStreamingMessage = async (message: string, mode: AIMode): Promise<{ imageAlreadyGenerated: boolean; imagePrompt: string | null }> => {
    if (isStreaming) return { imageAlreadyGenerated: false, imagePrompt: null };
    setIsStreaming(true);

    // Create the assistant placeholder once — reused across retries so there
    // is never a duplicate bubble in the chat.
    const assistantId = generateUUID();
    addMessage({
      id: assistantId,
      sessionId: sessionId || '',
      conversationId: currentConversationId || undefined,
      role: 'assistant',
      content: '',
      mode,
      timestamp: new Date().toISOString(),
    });

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Clear any partial content from a previous failed attempt before retrying
        if (attempt > 1) updateMessageContent(assistantId, '');
        const result = await _doStreamingMessage(message, mode, assistantId);
        setReconnectState(null);
        setIsStreaming(false);
        return result;
      } catch (e: unknown) {
        if (isNetworkError(e) && attempt < MAX_RETRIES) {
          console.warn(`[Reconnect] Network error on attempt ${attempt}/${MAX_RETRIES}. Waiting for server...`);
          setReconnectState({ active: true, attempt, max: MAX_RETRIES });
          const back = await waitForServer(30000);
          if (!back) {
            setReconnectState(null);
            updateMessageContent(assistantId, `_(Server unreachable — could not reconnect. Please refresh the page.)_`);
            toast({ title: 'Server unreachable', description: 'Could not reconnect after 30s. Please refresh the page.', variant: 'destructive' });
            setIsStreaming(false);
            return { imageAlreadyGenerated: true, imagePrompt: null };
          }
          // Brief pause so the server finishes starting before we hammer it again
          await new Promise((res) => setTimeout(res, 800));
          setReconnectState({ active: true, attempt: attempt + 1, max: MAX_RETRIES });
          continue;
        }
        // Not a network error, or exhausted retries — show error in the placeholder
        setReconnectState(null);
        const msg = e instanceof Error ? e.message : 'Failed to send message. Please try again.';
        updateMessageContent(assistantId, `_(Error: ${msg})_`);
        toast({ title: 'Error', description: msg, variant: 'destructive' });
        setIsStreaming(false);
        return { imageAlreadyGenerated: true, imagePrompt: null };
      }
    }

    setReconnectState(null);
    setIsStreaming(false);
    return { imageAlreadyGenerated: true, imagePrompt: null };
  };

  const _doStreamingMessage = async (message: string, mode: AIMode, assistantId: string): Promise<{ imageAlreadyGenerated: boolean; imagePrompt: string | null }> => {

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionId) headers['X-Session-ID'] = sessionId;

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          message,
          mode,
          conversationId: currentConversationId,
          learningEnabled,
          advancedReasoningEnabled,
          faithEnhancementEnabled,
          webSearchEnabled,
          textModel,
          imageModel,
          maxTokens,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        if (response.status === 429) {
          // Rate limited — don't pollute the chat, just show a toast
          const friendly = err.message || 'Too many messages — please wait a moment before sending more.';
          toast({ title: 'Slow down a little ✋', description: friendly });
          // Remove the blank assistant placeholder we already added
          setMessages(messages.filter((m) => m.id !== assistantId));
          setIsStreaming(false);
          return { imageAlreadyGenerated: false, imagePrompt: null };
        }
        throw new Error(err.error || `Error ${response.status}`);
      }

      // --- AUTOMATION_DIVERTED preflight ---
      // When the backend intercepts a long-horizon task it returns plain JSON
      // (Content-Type: application/json) instead of an SSE stream.
      // We detect this before touching the stream reader so the normal SSE
      // path is 100% untouched for every other request.
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.clone().json().catch(() => null);
        if (data && data.status === 'AUTOMATION_DIVERTED') {
          console.log('[UI_SYSTEM] Intercepted artifact job. Mounting progress card.', data.jobId);
          // Replace the blank assistant placeholder with the artifact job payload
          // encoded as JSON in the content field — no schema change required.
          setMessages(
            messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `__ARTIFACT_JOB__:${JSON.stringify({
                      jobId: data.jobId,
                      targetEndpoint: data.targetEndpoint,
                      modeContext: data.modeContext,
                    })}`,
                  }
                : m
            )
          );
          return { imageAlreadyGenerated: false, imagePrompt: null };
        }
      }
      // --- END PREFLIGHT. SSE stream reader below is completely untouched. ---

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let streamImageAlreadyGenerated = false;
      let streamImagePrompt: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.token) {
              accumulated += parsed.token;
              updateMessageContent(assistantId, accumulated);
            }
            if (parsed.done) {
              setCurrentConversationId(parsed.conversationId);
              queryClient.invalidateQueries({ queryKey: ["conversationHistory"] });
              if (parsed.imageUrl) {
                const freshImageUrl = parsed.imageUrl.includes('?')
                  ? `${parsed.imageUrl}&v=${Date.now()}`
                  : `${parsed.imageUrl}?v=${Date.now()}`;
                setGeneratedImage(freshImageUrl);
                streamImageAlreadyGenerated = true;
                // Keep the original visual request when the response has no image tag.
                const tagMatch = accumulated.match(/\[IMAGE:\s*([\s\S]+?)\](?!\()/i);
                streamImagePrompt = tagMatch?.[1]?.trim() ?? message;
                setBaseImagePrompt(streamImagePrompt);
                toast({ title: "Image Generated", description: "Your image has been created." });
              }
              if (mode === 'video_generator' || primaryMode === 'video_generator') {
                videoMutation.mutate(message);
              }
            }
            if (parsed.error) throw new Error(parsed.error);
          } catch (parseErr) {
            // skip malformed SSE lines
          }
        }
      }
      return { imageAlreadyGenerated: streamImageAlreadyGenerated, imagePrompt: streamImagePrompt };
    } catch (error: unknown) {
      // Re-throw so the outer sendStreamingMessage retry loop can inspect it.
      // The outer function is responsible for updating the placeholder and toast.
      throw error;
    }
  };


  function detectIntent(text: string) {
    const t = text.toLowerCase();
    const wantsImage = /\b(image|picture|photo|draw|paint|visualize|illustrate|show me|create art|portrait|artwork|render|visual|painting|sketch|generate.*image|image.*generate)\b/.test(t);
    const wantsVideo = /\b(video|movie|film|animate|animation|cinematic|motion picture|clip|reel|generate.*video|video.*generate|make.*video|create.*film)\b/.test(t);
    const wantsSearch = /\b(search|look up|find out|what is|who is|when did|latest news|current events|2025|2026|recent|today|this year|last year|breaking|news|real.?time|live|internet|web)\b/.test(t);
    const wantsStory = /\b(write|story|tale|narrative|chapter|scene|fiction|prose|poem|novel|screenplay|plot|character|dialogue)\b/.test(t) || (!wantsImage && !wantsVideo);
    return { wantsImage, wantsVideo, wantsSearch, wantsStory };
  }

  // Analyze code blocks in a message when in code_graph mode
  const analyzeCodeGraph = async (msg: string) => {
    const codeBlockRe = /```([\w]*)\n?([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let detectedLang = '';
    let m: RegExpExecArray | null;
    while ((m = codeBlockRe.exec(msg)) !== null) {
      const lang = m[1].trim();
      const body = m[2].trim();
      if (body) {
        codeBlocks.push(body);
        if (!detectedLang && lang) detectedLang = lang;
      }
    }
    // Fallback: raw code heuristic (≥5 lines with code keywords)
    if (codeBlocks.length === 0 && msg.split('\n').length >= 5) {
      if (/\b(function|const|let|var|class|import|export|def |fn |package )\b/.test(msg)) {
        codeBlocks.push(msg);
      }
    }
    if (codeBlocks.length === 0) return;

    setCodeGraphLoading(true);
    try {
      const resp = await apiRequest('POST', '/api/code-graph/analyze', {
        code: codeBlocks.join('\n\n'),
        language: detectedLang || undefined,
      });
      if (resp.ok) {
        const data = await resp.json() as { success: boolean; graph: CodeGraph };
        if (data.success && data.graph) {
          setCodeGraph(data.graph);
        }
      }
    } catch (err) {
      console.warn('[CodeGraph] Analysis failed:', err);
    } finally {
      setCodeGraphLoading(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming || imageMutation.isPending || videoMutation.isPending) return;

    const msgText = input.trim();
    const intent = detectIntent(msgText);

    const userMessage: Message = {
      id: generateUUID(),
      sessionId: '',
      conversationId: currentConversationId || undefined,
      role: 'user',
      content: msgText,
      mode: primaryMode,
      timestamp: new Date().toISOString(),
    };

    addMessage(userMessage);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Kick off code graph analysis in parallel when in code_graph mode
    if (primaryMode === 'code_graph') {
      analyzeCodeGraph(msgText);
    }

    // Academic Research Mode: detect /full [topic] and trigger 70x7 Artifact Builder
    if (primaryMode === 'academic_research') {
      const fullMatch = msgText.match(/^\/full\s+(.+)/i);
      if (fullMatch) {
        const topic = fullMatch[1].trim();
        setArtifactTopic(topic);
        setArtifactPanelOpen(true);
        setArtifactResult(null);
        artifactMutation.mutate(topic);
        return;
      }
    }

    // Always stream the story/text response
    sendStreamingMessage(msgText, primaryMode).then((streamResult) => {
      if (intent.wantsImage && !streamResult.imageAlreadyGenerated && !imageMutation.isPending) {
        const imagePrompt = streamResult.imagePrompt || msgText;
        setTimeout(() => imageMutation.mutate({ prompt: imagePrompt, styles: [ART_STYLES[0]] }), 300);
      }
      // Video generation is EXCLUSIVE to video_generator mode — never auto-trigger from other modes
    }).catch(() => {});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRollbackRequest = (messageId: string) => {
    setRollbackConfirmId(messageId);
  };

  const handleRollbackConfirm = (messageId: string) => {
    rollbackToMessage(messageId);
    setRollbackConfirmId(null);
    setHoveredMessageId(null);
    toast({
      title: "Rolled back",
      description: "Conversation restored to this point. You can now continue from here.",
    });
  };

  const handleRollbackCancel = () => {
    setRollbackConfirmId(null);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const handleGenerateImage = (promptOverride?: string) => {
    const promptToUse = promptOverride || input;
    if (!promptToUse.trim()) {
      toast({
        title: "Error",
        description: "Please enter a description for the image.",
        variant: "destructive",
      });
      return;
    }
    // Reset style to default when generating fresh image
    setSelectedStyles([ART_STYLES[0]]);
    imageMutation.mutate({ prompt: promptToUse, styles: [ART_STYLES[0]] });
  };

  const handleRegenerateImage = () => {
    if (baseImagePrompt) {
      imageMutation.mutate({ prompt: baseImagePrompt, styles: selectedStyles });
    }
  };

  const handleGenerateVideo = (promptOverride?: string) => {
    const promptToUse = promptOverride || input;
    if (!promptToUse.trim()) {
      toast({ title: "Error", description: "Please enter a description for the video.", variant: "destructive" });
      return;
    }
    videoMutation.mutate(promptToUse);
  };

  const handleSandboxRun = () => {
    if (!sandboxInput.trim()) return;
    setSandboxOutput('');
    sandboxMutation.mutate({ prompt: sandboxInput });
  };

  const handleSandboxAudit = () => {
    const auditPrompt = sandboxInput.trim() ||
      'Audit all BetaGrace vI capabilities: story generation, image generation (Pollinations), video generation (multi-scene with FFmpeg), age verification, faith enhancement, and advanced reasoning. For each, state current status, known limitations, and recommended improvements. Use the 70×7 verification protocol.';
    setSandboxInput(auditPrompt);
    setSandboxOutput('');
    sandboxMutation.mutate({ prompt: auditPrompt, auditMode: true });
  };

  const handleSelfMendUnlock = () => {
    if (!selfMendPassword || selfMendPassword.trim().length === 0) {
      toast({ title: "Password Required", description: "Enter your DEV_PASSWORD to unlock.", variant: "destructive" });
      return;
    }
    // UI unlock — real auth is enforced server-side against DEV_PASSWORD env var
    setSelfMendUnlocked(true);
    toast({ title: "Dev Tools Visible", description: "Enter your server DEV_PASSWORD when submitting — the server validates it." });
  };

  const handleSelfMend = () => {
    if (!selfMendCode.trim()) {
      toast({ title: "Code Required", description: "Paste code to analyze.", variant: "destructive" });
      return;
    }
    setSelfMendOutput('');
    selfMendMutation.mutate({ password: selfMendPassword, code: selfMendCode, issue: selfMendIssue, language: selfMendLang });
  };

  const handlePushToCode = () => {
    if (!selfMendTargetFile.trim()) {
      toast({ title: "File Path Required", description: "Enter the target file path (e.g. server/routes.ts).", variant: "destructive" });
      return;
    }
    const fixedCode = extractFixedCode(selfMendOutput) || selfMendCode;
    if (!fixedCode) {
      toast({ title: "No Code", description: "Run an analysis first to extract the fixed code.", variant: "destructive" });
      return;
    }
    pushToCodeMutation.mutate({ filePath: selfMendTargetFile, code: fixedCode });
  };

  const modeColors = MODE_COLORS[primaryMode] ?? MODE_COLORS.standard;
  const modeMeta = MODE_METADATA[primaryMode] ?? MODE_METADATA.standard;

  // SECURITY: Sanitize HTML-like content in messages
  const sanitizeContent = (content: string): string => {
    if (!content || typeof content !== 'string') return '';
    
    // Remove script tags and dangerous attributes
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/on\w+\s*=\s*[^\s>]*/gi, '')
      .substring(0, 10000); // Limit content length
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-x-hidden" style={{ boxSizing: "border-box" }}>
      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4">
        <div className="max-w-3xl mx-auto py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
              <div className={cn("p-4 rounded-full", modeColors.bg)}>
                <Sparkles className={cn("w-12 h-12", modeColors.text)} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">Welcome to BetaGrace</h2>
                <p className="text-muted-foreground max-w-md">
                  Your AI-powered creative writing assistant. Start a conversation to explore 
                  dark supernatural narratives, spiritual warfare, and visceral prose.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {activeModes.map((mode) => {
                  const badgeColors = MODE_COLORS[mode] ?? MODE_COLORS.standard;
                  const badgeMeta = MODE_METADATA[mode] ?? MODE_METADATA.standard;
                  return (
                    <Badge key={mode} variant="outline" className={cn(badgeColors.bg, badgeColors.text)}>
                      {badgeMeta.name} Active
                    </Badge>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg mt-4">
                <Button 
                  variant="outline" 
                  className="h-auto py-3 px-4 text-left justify-start hover-elevate"
                  onClick={() => setInput("Write a scene of a mother protecting her children from supernatural forces")}
                  data-testid="button-prompt-1"
                >
                  <span className="text-sm">Protective mother scene</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-3 px-4 text-left justify-start hover-elevate"
                  onClick={() => setInput("Create a revelation scene where a terrible truth is uncovered")}
                  data-testid="button-prompt-2"
                >
                  <span className="text-sm">Revelation scene</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-3 px-4 text-left justify-start hover-elevate"
                  onClick={() => setInput("Write dialogue between sisters who share supernatural trauma")}
                  data-testid="button-prompt-3"
                >
                  <span className="text-sm">Sister dialogue</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto py-3 px-4 text-left justify-start hover-elevate"
                  onClick={() => setInput("Describe a haunted location with full sensory immersion")}
                  data-testid="button-prompt-4"
                >
                  <span className="text-sm">Haunted location</span>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Reconnect banner — shown when a network error triggered auto-retry */}
              {reconnectState?.active && (
                <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 dark:text-amber-400 mx-1 mb-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>
                    Server restarted — reconnecting and retrying
                    {reconnectState.max > 1 && (
                      <span className="opacity-70 ml-1">
                        (attempt {reconnectState.attempt}/{reconnectState.max})
                      </span>
                    )}
                    …
                  </span>
                </div>
              )}
              {/* Display all messages first */}
              {messages.map((message, msgIdx) => {
                // DEFENSIVE: Validate mode for each message
                const validMode = getValidMode(message.mode);
                const messageColors = MODE_COLORS[validMode];
                const messageMeta = MODE_METADATA[validMode];
                const isHovered = hoveredMessageId === message.id;
                const isConfirming = rollbackConfirmId === message.id;
                const isLastMessage = msgIdx === messages.length - 1;
                
                return (
                  <div
                    key={message.id || `msg-${msgIdx}`}
                    className={cn(
                      "flex gap-3 group relative",
                      message.role === 'user' ? "justify-end" : "justify-start"
                    )}
                    data-testid={`message-${message.id}`}
                    onMouseEnter={() => setHoveredMessageId(message.id)}
                    onMouseLeave={() => {
                      if (rollbackConfirmId !== message.id) setHoveredMessageId(null);
                    }}
                  >
                    {message.role === 'assistant' && (
                      <Avatar className="w-8 h-8 shrink-0">
                        <AvatarFallback className={cn(messageColors.bg, messageColors.text)}>
                          <Sparkles className="w-4 h-4" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    
                    <div className={cn(
                      "max-w-[92%] sm:max-w-[80%] space-y-1",
                      message.role === 'user' && "order-first"
                    )}>
                      {(() => {
                        // Detect artifact job payload encoded in the content field
                        if (message.role === 'assistant' && message.content.startsWith('__ARTIFACT_JOB__:')) {
                          try {
                            const payload = JSON.parse(message.content.slice('__ARTIFACT_JOB__:'.length));
                            return (
                              <ArtifactProgressCard
                                jobId={payload.jobId}
                                targetEndpoint={payload.targetEndpoint}
                                modeContext={payload.modeContext}
                              />
                            );
                          } catch {
                            // Fall through to standard renderer if JSON is malformed
                          }
                        }
                        return (
                          <Card className={cn(
                            message.role === 'user'
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/50",
                            isConfirming && "ring-2 ring-amber-400 dark:ring-amber-500"
                          )}>
                            <CardContent className="p-3">
                              <p className="text-sm whitespace-pre-wrap" data-testid={`message-content-${message.id}`}>
                                {sanitizeContent(message.content)}
                              </p>
                            </CardContent>
                          </Card>
                        );
                      })()}

                      {/* Rollback confirm prompt */}
                      {isConfirming && (
                        <div className="flex items-center gap-2 px-1 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 text-xs">
                          <RotateCcw className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="text-amber-800 dark:text-amber-300 flex-1">Roll back to this message? Everything after it will be removed.</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-5 text-[10px] px-2 py-0"
                            onClick={() => handleRollbackConfirm(message.id)}
                            data-testid={`button-rollback-confirm-${message.id}`}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[10px] px-2 py-0"
                            onClick={handleRollbackCancel}
                            data-testid={`button-rollback-cancel-${message.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      
                      <div className={cn(
                        "flex items-center gap-2 text-xs text-muted-foreground",
                        message.role === 'user' && "justify-end"
                      )}>
                        <Badge variant="outline" className="text-[10px] h-4 px-1">
                          {messageMeta.name}
                        </Badge>
                        {message.tokens && (
                          <span>{message.tokens} tokens</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleCopy(message.content, message.id)}
                          data-testid={`button-copy-${message.id}`}
                          title={message.role === 'user' ? 'Copy your message' : 'Copy response'}
                        >
                          {copiedId === message.id ? (
                            <Check className="w-3 h-3 text-green-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                        {/* Rollback button — visible on hover, hidden on the last message */}
                        {!isLastMessage && (isHovered || isConfirming) && !isConfirming && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400"
                            title="Roll back conversation to this point"
                            onClick={() => handleRollbackRequest(message.id)}
                            data-testid={`button-rollback-${message.id}`}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                        )}
                        {/* Continue button — only on the last assistant message, when idle */}
                        {isLastMessage && message.role === 'assistant' && !isStreaming && message.content.trim().length > 0 && !message.content.startsWith('__ARTIFACT_JOB__') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-5 text-[10px] px-2 py-0 border-dashed"
                            title="Ask the AI to continue its response"
                            onClick={() => {
                              const continueMsg: Message = {
                                id: generateUUID(),
                                sessionId: '',
                                conversationId: currentConversationId || undefined,
                                role: 'user',
                                content: 'continue',
                                mode: primaryMode,
                                timestamp: new Date().toISOString(),
                              };
                              addMessage(continueMsg);
                              sendStreamingMessage('continue', primaryMode);
                            }}
                            data-testid="button-continue"
                          >
                            Continue ›
                          </Button>
                        )}
                      </div>
                    </div>

                    {message.role === 'user' && (
                      <Avatar className="w-8 h-8 shrink-0">
                        <AvatarFallback className="bg-primary/10">
                          <User className="w-4 h-4" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              })}

              {isStreaming && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className={cn(modeColors.bg, modeColors.text)}>
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </AvatarFallback>
                  </Avatar>
                  <Card className="bg-muted/50 max-w-[80%]">
                    <CardContent className="p-3 space-y-2">
                      <Skeleton className="h-4 w-[250px]" />
                      <Skeleton className="h-4 w-[200px]" />
                      <Skeleton className="h-4 w-[180px]" />
                    </CardContent>
                  </Card>
                </div>
              )}

              {imageMutation.isPending && (
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className={cn(modeColors.bg, modeColors.text)}>
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </AvatarFallback>
                  </Avatar>
                  <Card className="bg-muted/50 max-w-[80%]">
                    <CardContent className="p-3">
                      <Skeleton className="h-[300px] w-full rounded-lg" />
                    </CardContent>
                  </Card>
                </div>
              )}

              {videoMutation.isPending && (
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className="bg-rose-500/20 text-rose-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </AvatarFallback>
                  </Avatar>
                  <Card className="bg-muted/50 max-w-[80%] border-rose-500/20">
                    <CardContent className="p-3 space-y-2">
                      <div className="text-xs font-semibold text-rose-500 mb-1 flex items-center gap-1">
                        <Video className="w-3 h-3" />
                        Generating video (2–20 minutes for up to 20 scenes)...
                      </div>
                      <Skeleton className="h-[220px] w-full rounded-lg bg-rose-500/10" />
                      <p className="text-[10px] text-muted-foreground">Generating your cinematic scene...</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {generatedStoryboard && generatedStoryboard.length > 0 && (
                <StoryboardPlayer
                  frames={generatedStoryboard}
                  captions={generatedStoryboardCaptions ?? undefined}
                  onClear={() => { setGeneratedStoryboard(null); setGeneratedStoryboardCaptions(null); }}
                />
              )}

              {generatedVideo && (
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className="bg-rose-500/20 text-rose-500">
                      <Video className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <Card className="bg-muted/50 max-w-[80%] border-rose-500/20">
                    <CardContent className="p-3 space-y-2">
                      <div className="text-xs font-semibold text-rose-500 mb-1 flex items-center gap-1">
                        <Video className="w-3 h-3" />
                        Generated Video
                      </div>
                      <div className="rounded-lg overflow-hidden bg-black aspect-video">
                        <video
                          key={generatedVideo}
                          src={generatedVideo}
                          controls
                          autoPlay
                          loop
                          playsInline
                          className="w-full h-full rounded-lg"
                          onError={() => {
                            console.error('[ChatInterface] Video load failed:', generatedVideo);
                            setGeneratedVideo(null);
                            toast({ title: "Video Error", description: "Could not load video file.", variant: "destructive" });
                          }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          onClick={() => {
                            const a = document.createElement('a');
                            a.href = generatedVideo;
                            a.download = `betagrace-video-${Date.now()}.mp4`;
                            a.click();
                          }}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          onClick={() => setGeneratedVideo(null)}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Clear
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {generatedImage && (
                <div className="flex gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarFallback className={cn(modeColors.bg, modeColors.text)}>
                      <ImageIcon className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <Card className="bg-muted/50 max-w-[80%]">
                    <CardContent className="p-3 space-y-2">
                      <div className="rounded-lg overflow-hidden bg-black/5">
                        <img 
                          src={generatedImage} 
                          alt="Generated" 
                          className="w-full h-auto rounded-lg" 
                          data-testid="img-generated"
                          crossOrigin="anonymous"
                          onError={(e) => {
                            console.error('[ChatInterface] Image load failed:', e);
                            console.error('[ChatInterface] Failed URL:', generatedImage);
                            toast({
                              title: "Image Load Error",
                              description: "Failed to load the generated image. The URL may be invalid or the image generation failed.",
                              variant: "destructive",
                            });
                            setGeneratedImage(null);
                          }}
                          onLoad={() => {
                            console.log('[ChatInterface] Image loaded successfully');
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground mb-1">
                          Art Styles ({selectedStyles.length}/{MAX_STYLES}):
                        </div>
                        {selectedStyles.length > 1 && (
                          <div className="flex flex-wrap gap-1 mb-2 p-2 bg-muted/50 rounded">
                            {selectedStyles.slice(1).map((style) => {
                              const styleName = style.includes(':') ? style.split(':')[0] : style;
                              return (
                                <Badge 
                                  key={style}
                                  variant="secondary"
                                  className="cursor-pointer text-xs gap-1 hover:opacity-80 transition-opacity"
                                  onClick={() => {
                                    setSelectedStyles(selectedStyles.filter(s => s !== style));
                                  }}
                                  data-testid={`badge-selected-${styleName.replace(/\s+/g, '-')}`}
                                >
                                  {styleName}
                                  <span className="ml-1">✕</span>
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                        <Select 
                          value="" 
                          onValueChange={(value) => {
                            const style = value as ArtStyle;
                            if (!selectedStyles.includes(style) && selectedStyles.length < MAX_STYLES) {
                              setSelectedStyles([...selectedStyles, style]);
                            }
                          }} 
                          disabled={imageMutation.isPending || selectedStyles.length >= MAX_STYLES}
                        >
                          <SelectTrigger className="w-full h-8 text-xs" data-testid="select-art-style">
                            <SelectValue placeholder={selectedStyles.length >= MAX_STYLES ? "Max styles reached" : "+ Add Style"} />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {ART_STYLES.map((style) => {
                              const isSelected = selectedStyles.includes(style);
                              const styleName = style.includes(':') ? style.split(':')[0] : style;
                              return (
                                <SelectItem key={style} value={style} className="text-xs" disabled={isSelected}>
                                  {isSelected ? `✓ ${styleName}` : styleName}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {selectedStyles.length > 1 && (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => imageMutation.mutate({ prompt: baseImagePrompt || '', styles: selectedStyles })}
                            disabled={imageMutation.isPending || !baseImagePrompt}
                            data-testid="button-apply-styles"
                          >
                            {imageMutation.isPending ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Regenerating...
                              </>
                            ) : (
                              'Regenerate with Styles'
                            )}
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!generatedImage) return;
                            const a = document.createElement('a');
                            a.href = generatedImage;
                            a.download = `betagrace-${Date.now()}.jpg`;
                            a.setAttribute('target', '_blank');
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            toast({ title: "Downloaded", description: "Image saved as JPG" });
                          }}
                          data-testid="button-download-image"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setGeneratedImage(null)}
                          data-testid="button-clear-image"
                        >
                          Clear
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-3xl mx-auto p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-0.5 min-w-0">
              {isGenerating && (
                <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
                  <Lock className="w-2.5 h-2.5" />
                  <span className="hidden sm:inline font-mono">Generating…</span>
                </div>
              )}
              <Button
                variant={advancedReasoningEnabled ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 text-xs transition-all shrink-0",
                  advancedReasoningEnabled && "bg-purple-600 hover:bg-purple-700",
                  isGenerating && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => !isGenerating && setAdvancedReasoningEnabled(!advancedReasoningEnabled)}
                disabled={isGenerating}
                data-testid="button-toggle-reasoning"
              >
                <Brain className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Reasoning </span>{advancedReasoningEnabled ? "ON" : "OFF"}
              </Button>
              <Button
                variant={faithEnhancementEnabled ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 text-xs transition-all shrink-0",
                  faithEnhancementEnabled && "bg-amber-600 hover:bg-amber-700",
                  isGenerating && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => !isGenerating && setFaithEnhancementEnabled(!faithEnhancementEnabled)}
                disabled={isGenerating}
                data-testid="button-toggle-faith"
              >
                <Cross className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Faith </span>{faithEnhancementEnabled ? "ON" : "OFF"}
              </Button>
              <Button
                variant={webSearchEnabled ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-7 text-xs transition-all shrink-0",
                  webSearchEnabled && "bg-sky-600 hover:bg-sky-700",
                  isGenerating && "opacity-50 cursor-not-allowed"
                )}
                onClick={() => {
                  if (isGenerating) return;
                  const next = !webSearchEnabled;
                  setWebSearchEnabled(next);
                  setWebSearchPanelOpen(next);
                }}
                disabled={isGenerating}
                data-testid="button-toggle-web-search"
              >
                <Globe className="w-3 h-3 mr-1" />
                <span className="hidden sm:inline">Web </span>Search {webSearchEnabled ? "ON" : "OFF"}
              </Button>
              <Select value={String(maxTokens)} onValueChange={(v) => { if (!isGenerating) setMaxTokens(Number(v)); }} disabled={isGenerating}>
                <SelectTrigger className="h-7 text-xs w-[80px] shrink-0 border-muted-foreground/30" data-testid="select-max-tokens">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8192">8K</SelectItem>
                  <SelectItem value="16384">16K</SelectItem>
                  <SelectItem value="32768">32K</SelectItem>
                  <SelectItem value="65536">64K</SelectItem>
                </SelectContent>
              </Select>
              <Select value={textModel} onValueChange={isGenerating ? undefined : setTextModel} disabled={isGenerating}>
                <SelectTrigger className="h-7 text-xs w-[86px] shrink-0 border-muted-foreground/30" data-testid="select-text-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="deepseek">DeepSeek</SelectItem>
                  <SelectItem value="mistral">Mistral</SelectItem>
                </SelectContent>
              </Select>
              <Select value={imageModel} onValueChange={isGenerating ? undefined : setImageModel} disabled={isGenerating}>
                <SelectTrigger className="h-7 text-xs w-[96px] shrink-0 border-muted-foreground/30" data-testid="select-image-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flux">Flux</SelectItem>
                  <SelectItem value="gptimage">GPT Image</SelectItem>
                  <SelectItem value="turbo">Turbo</SelectItem>
                  <SelectItem value="seedream">SeeDream</SelectItem>
                </SelectContent>
              </Select>
              {primaryMode === 'autonomous' && (
                <Badge variant="outline" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400 shrink-0">
                  <Zap className="w-3 h-3 mr-1" />
                  Auto
                </Badge>
              )}
              {primaryMode === 'academic_research' && (
                <Button
                  variant={artifactPanelOpen ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-7 text-xs transition-all shrink-0",
                    artifactPanelOpen && "bg-emerald-600 hover:bg-emerald-700",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => { if (!isGenerating) setArtifactPanelOpen(!artifactPanelOpen); }}
                  disabled={artifactMutation.isPending}
                  data-testid="button-artifact-builder"
                >
                  <BookOpen className="w-3 h-3 mr-1" />
                  <span className="hidden sm:inline">Write </span>Artifact
                </Button>
              )}
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 text-xs shrink-0"
                onClick={clearMessages}
                data-testid="button-clear-chat"
              >
                <Trash2 className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">Clear chat</span>
              </Button>
            )}
          </div>


          {/* Web Search Panel */}
          {webSearchPanelOpen && (
            <div className="border rounded-lg bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800 mb-3 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-sky-200 dark:border-sky-800">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">Live Web Search</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-sky-400 text-sky-600 dark:text-sky-400">DuckDuckGo</Badge>
                </div>
                <button
                  type="button"
                  onClick={() => setWebSearchPanelOpen(false)}
                  className="text-sky-400 hover:text-sky-600 dark:hover:text-sky-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-3 py-3 space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Web Search is <span className="text-sky-600 dark:text-sky-400 font-semibold">ON</span> — BetaGrace vI will automatically inject live search results into every response. You can also run a manual search below.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={webSearchQuery}
                    onChange={e => setWebSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleWebSearch()}
                    placeholder="Search the web directly…"
                    className="flex-1 text-xs px-2 py-1.5 rounded border bg-background"
                    data-testid="input-web-search"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-sky-400 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/30"
                    onClick={handleWebSearch}
                    disabled={webSearchMutation.isPending || !webSearchQuery.trim()}
                    data-testid="button-web-search-run"
                  >
                    {webSearchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  </Button>
                </div>
                {webSearchResults && (
                  <div className="border rounded-md p-2.5 bg-background max-h-[200px] overflow-y-auto space-y-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400">Results for: "{webSearchResults.query}"</span>
                      <span className="text-[9px] text-muted-foreground">{webSearchResults.source}</span>
                    </div>
                    <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-foreground/90">{webSearchResults.results}</pre>
                    <button
                      type="button"
                      className="text-[10px] text-sky-500 hover:text-sky-700 mt-1 underline"
                      onClick={() => {
                        setInput(prev => prev ? `${prev}\n\n[Web search results for "${webSearchResults.query}"]\n${webSearchResults.results}` : `[Web search results for "${webSearchResults.query}"]\n${webSearchResults.results}`);
                        setWebSearchResults(null);
                      }}
                    >
                      Insert results into message
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Academic Artifact Builder Panel — Academic Research Mode Only */}
          {primaryMode === 'academic_research' && artifactPanelOpen && (
            <div className="border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 mb-3 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">70×7 Artifact Builder</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-400 text-emerald-600 dark:text-emerald-400">ACADEMIC RESEARCH</Badge>
                </div>
                <button
                  type="button"
                  onClick={() => setArtifactPanelOpen(false)}
                  className="text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-3 py-3 space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Enter a research topic to generate a full multi-section academic paper. Each section is written independently and appended to a downloadable Markdown file. You can also type <span className="font-mono text-emerald-600 dark:text-emerald-400">/full [topic]</span> in the chat.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={artifactTopic}
                    onChange={e => setArtifactTopic(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !artifactJobId && !artifactMutation.isPending && handleBuildArtifact()}
                    placeholder="e.g. The effects of AI on academic research methodology…"
                    className="flex-1 text-xs px-2 py-1.5 rounded border bg-background"
                    data-testid="input-artifact-topic"
                    disabled={!!artifactJobId || artifactMutation.isPending}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 shrink-0"
                    onClick={() => handleBuildArtifact()}
                    disabled={!!artifactJobId || artifactMutation.isPending || !artifactTopic.trim()}
                    data-testid="button-artifact-build"
                  >
                    {(artifactJobId || artifactMutation.isPending) ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                  </Button>
                </div>

                {/* Building progress — shows while job is running in background */}
                {(artifactJobId || artifactMutation.isPending) && (
                  <div className="border rounded-md p-2.5 bg-background">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-500 shrink-0" />
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {artifactPollData?.totalSections
                          ? `Section ${artifactPollData.sectionsCompleted + 1}/${artifactPollData.totalSections} — ${artifactPollData.currentSection}`
                          : 'Initialising pipeline…'}
                      </span>
                    </div>
                    {artifactPollData?.totalSections ? (
                      <div className="mt-1.5 h-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(5, (artifactPollData.sectionsCompleted / artifactPollData.totalSections) * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="mt-1.5 h-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full animate-pulse" style={{ width: '15%' }} />
                      </div>
                    )}
                    <p className="text-[9px] text-muted-foreground mt-1">
                      Writing sections independently — the paper is being assembled in the background.
                    </p>
                  </div>
                )}

                {/* Completed artifact */}
                {artifactResult && !artifactJobId && (
                  <div className="border rounded-md bg-background overflow-hidden">
                    <div className="flex items-center justify-between px-2.5 py-2 border-b bg-emerald-50/60 dark:bg-emerald-950/30">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          {artifactResult.sectionsCompleted > 0
                            ? `${artifactResult.sectionsCompleted}/${artifactResult.totalSections} sections · `
                            : ''}{(artifactResult.charCount / 1000).toFixed(1)}k chars
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 px-2"
                        onClick={handleDownloadArtifact}
                        data-testid="button-artifact-download"
                      >
                        <Download className="w-2.5 h-2.5 mr-1" />
                        Download .md
                      </Button>
                    </div>
                    <div className="max-h-[180px] overflow-y-auto p-2.5">
                      <pre className="text-[9px] font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
                        {artifactResult.artifact.substring(0, 800)}{artifactResult.artifact.length > 800 ? '\n\n… (download for full document)' : ''}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Artifact history — all previous completed/building jobs */}
                <ArtifactHistoryPanel onArtifactSelect={handleHistoryArtifactSelect} />
              </div>
            </div>
          )}

          {/* Dev Sandbox — Autonomous Mode Only */}
          {primaryMode === 'autonomous' && (
            <div className="border rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 mb-3 overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
                onClick={() => setDevSandboxOpen(!devSandboxOpen)}
                data-testid="button-dev-sandbox-toggle"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-mono font-semibold text-amber-700 dark:text-amber-400">Dev Sandbox</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-400 text-amber-600 dark:text-amber-400">AUTONOMOUS</Badge>
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 text-amber-600 dark:text-amber-400 transition-transform", devSandboxOpen && "rotate-180")} />
              </button>
              {devSandboxOpen && (
                <div className="border-t border-amber-200 dark:border-amber-800 px-3 py-3 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-background rounded-md border">
                      <div className="text-sm font-bold">{messages.length}</div>
                      <div className="text-[10px] text-muted-foreground">Messages</div>
                    </div>
                    <div className="p-2 bg-background rounded-md border">
                      <div className="text-xs font-bold font-mono truncate">{primaryMode}</div>
                      <div className="text-[10px] text-muted-foreground">Mode</div>
                    </div>
                    <div className="p-2 bg-background rounded-md border">
                      <div className="text-xs font-bold font-mono">{sessionId?.slice(-6) || '—'}</div>
                      <div className="text-[10px] text-muted-foreground">Session</div>
                    </div>
                  </div>
                  <Textarea
                    value={sandboxInput}
                    onChange={e => setSandboxInput(e.target.value)}
                    placeholder="Test any prompt directly with full autonomous context + all knowledge..."
                    className="min-h-[60px] max-h-[120px] text-xs font-mono resize-none bg-background"
                    data-testid="input-sandbox"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      onClick={handleSandboxRun}
                      disabled={sandboxMutation.isPending || !sandboxInput.trim()}
                      data-testid="button-sandbox-run"
                    >
                      {sandboxMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                      Run
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-rose-400 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                      onClick={handleSandboxAudit}
                      disabled={sandboxMutation.isPending}
                      data-testid="button-sandbox-audit"
                    >
                      <Shield className="w-3 h-3 mr-1" />
                      Audit 70×7
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 ml-auto"
                      onClick={() => { setSandboxInput(''); setSandboxOutput(''); }}
                    >
                      Clear
                    </Button>
                  </div>
                  {sandboxOutput && (
                    <div className="border rounded-md p-2.5 bg-background max-h-[220px] overflow-y-auto">
                      <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-foreground/90">{sandboxOutput}</pre>
                    </div>
                  )}

                  {/* Self-Mending Code Engine */}
                  <div className="border rounded-lg border-red-200 dark:border-red-800 overflow-hidden mt-2">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 bg-red-50/60 dark:bg-red-950/30 hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors"
                      onClick={() => setSelfMendOpen(!selfMendOpen)}
                    >
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                        <span className="text-xs font-mono font-semibold text-red-700 dark:text-red-400">Self-Mending Code Engine</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1 border-red-400 text-red-600 dark:text-red-400">DEV LOCKED</Badge>
                      </div>
                      <ChevronDown className={cn("w-3.5 h-3.5 text-red-500 transition-transform", selfMendOpen && "rotate-180")} />
                    </button>

                    {selfMendOpen && (
                      <div className="border-t border-red-200 dark:border-red-800 px-3 py-3 space-y-2 bg-background">
                        {!selfMendUnlocked ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-muted-foreground">Enter developer password to unlock autonomous code analysis and repair.</p>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={selfMendPassword}
                                onChange={e => setSelfMendPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSelfMendUnlock()}
                                placeholder="Developer password…"
                                className="flex-1 text-xs px-2 py-1 rounded border bg-background font-mono"
                              />
                              <Button size="sm" variant="outline" className="text-xs h-7 border-red-400 text-red-700 dark:text-red-400" onClick={handleSelfMendUnlock}>
                                Unlock
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={selfMendLang}
                                onChange={e => setSelfMendLang(e.target.value)}
                                placeholder="Language (e.g. typescript, python)…"
                                className="flex-1 text-xs px-2 py-1 rounded border bg-background font-mono"
                              />
                            </div>
                            <input
                              type="text"
                              value={selfMendIssue}
                              onChange={e => setSelfMendIssue(e.target.value)}
                              placeholder="Describe the issue (optional)…"
                              className="w-full text-xs px-2 py-1 rounded border bg-background"
                            />
                            <Textarea
                              value={selfMendCode}
                              onChange={e => setSelfMendCode(e.target.value)}
                              placeholder="Paste code to analyze and self-mend…"
                              className="min-h-[80px] max-h-[160px] text-xs font-mono resize-none bg-background"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 border-red-500 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                                onClick={handleSelfMend}
                                disabled={selfMendMutation.isPending || !selfMendCode.trim()}
                              >
                                {selfMendMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wrench className="w-3 h-3 mr-1" />}
                                Analyze & Fix
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7 ml-auto" onClick={() => { setSelfMendCode(''); setSelfMendOutput(''); setSelfMendIssue(''); }}>
                                Clear
                              </Button>
                            </div>
                            {selfMendOutput && (
                              <div className="border rounded-md p-2.5 bg-background max-h-[300px] overflow-y-auto">
                                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-foreground/90">{selfMendOutput}</pre>
                              </div>
                            )}

                            {/* Push to Code — write fixed code directly to a workspace file */}
                            {selfMendOutput && (
                              <div className="border border-dashed border-red-300 dark:border-red-700 rounded-md p-2.5 space-y-2 bg-red-50/40 dark:bg-red-950/20 mt-1">
                                <div className="flex items-center gap-1.5">
                                  <Upload className="w-3 h-3 text-red-600 dark:text-red-400" />
                                  <span className="text-[10px] font-mono font-semibold text-red-700 dark:text-red-400">Push to Code</span>
                                  <span className="text-[9px] text-muted-foreground">(writes the extracted fix to disk)</span>
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={selfMendTargetFile}
                                    onChange={e => setSelfMendTargetFile(e.target.value)}
                                    placeholder="Target file path (e.g. server/routes.ts)"
                                    className="flex-1 text-xs px-2 py-1 rounded border bg-background font-mono"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-7 border-red-500 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 shrink-0"
                                    onClick={handlePushToCode}
                                    disabled={pushToCodeMutation.isPending || !selfMendTargetFile.trim()}
                                    data-testid="button-push-to-code"
                                  >
                                    {pushToCodeMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                                    Push
                                  </Button>
                                </div>
                                <p className="text-[9px] text-muted-foreground">
                                  Pushes the first code block from the analysis above. Double-check the path before pushing.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Code Graph Panel — renders when code_graph mode is active ── */}
          {primaryMode === 'code_graph' && (codeGraph || codeGraphLoading) && (
            <div className="mb-3" data-testid="code-graph-container">
              {codeGraphLoading && !codeGraph && (
                <div className="border border-cyan-500/40 rounded-lg px-3 py-2 text-xs font-mono text-cyan-400 flex items-center gap-2 bg-cyan-950/20">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  Extracting knowledge graph…
                </div>
              )}
              {codeGraph && (
                <CodeGraphPanel graph={codeGraph} onClose={() => setCodeGraph(null)} />
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message BetaGrace vI — ask anything, request a story, image, video, or web search…`}
              className="min-h-[52px] max-h-[200px] pr-12 resize-none"
              disabled={isGenerating}
              data-testid="input-chat-message"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || isGenerating}
              data-testid="button-send-message"
              className="absolute right-2 bottom-2"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </form>
          
          <div className="flex items-center justify-center gap-1.5 mt-2 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
            <p className="text-[11px] text-amber-700 dark:text-amber-400 text-center leading-tight">
              BetaGrace vI can make mistakes — verify important information before acting on it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}