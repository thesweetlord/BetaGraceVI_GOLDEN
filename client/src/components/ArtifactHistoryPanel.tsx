import { useState, useEffect } from "react";
import { Loader2, BookOpen, ChevronDown, ChevronUp, Download, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ArtifactSummary {
  jobId: string;
  topic: string;
  status: string;
  sectionsCompleted: number;
  totalSections: number;
  charCount: number;
  createdAt: string;
  error?: string;
}

interface Props {
  onArtifactSelect: (content: string, topic: string) => void;
}

const REFRESH_MS = 5000;

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "building")
    return <Loader2 className="w-3 h-3 animate-spin text-amber-500 shrink-0 mt-0.5" />;
  if (status === "complete")
    return <span className="text-[13px] shrink-0 mt-0.5">✅</span>;
  return <span className="text-[13px] shrink-0 mt-0.5">❌</span>;
};

async function fetchArtifactContent(jobId: string): Promise<string | null> {
  try {
    const resp = await fetch(`/api/academic/artifact/status/${jobId}`, { credentials: "include" });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.artifact ?? data.job?.artifact ?? null;
  } catch {
    return null;
  }
}

function triggerDownload(content: string, topic: string, jobId: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${topic.slice(0, 40).replace(/[^a-z0-9]/gi, "_")}_${jobId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ArtifactHistoryPanel({ onArtifactSelect }: Props) {
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchHistory = async () => {
    try {
      const resp = await fetch("/api/academic/artifacts/history", { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.success && Array.isArray(data.artifacts)) setItems(data.artifacts);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    const hasBuilding = items.some((i) => i.status === "building");
    if (!hasBuilding) return;
    const id = setInterval(fetchHistory, REFRESH_MS);
    return () => clearInterval(id);
  }, [items]);

  const handleSelect = async (item: ArtifactSummary) => {
    if (item.status !== "complete") return;
    try {
      const resp = await fetch(`/api/academic/artifact/status/${item.jobId}`, { credentials: "include" });
      const data = await resp.json();
      if (data.success && data.artifact) onArtifactSelect(data.artifact, item.topic);
    } catch {}
  };

  const handleDownloadOne = async (e: React.MouseEvent, item: ArtifactSummary) => {
    e.stopPropagation();
    if (item.status !== "complete" || downloadingId) return;
    setDownloadingId(item.jobId);
    try {
      const content = await fetchArtifactContent(item.jobId);
      if (content) triggerDownload(content, item.topic, item.jobId);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExportAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const complete = items.filter((i) => i.status === "complete");
    if (exportingAll || complete.length === 0) return;
    setExportingAll(true);
    setExportProgress({ done: 0, total: complete.length });
    try {
      for (let i = 0; i < complete.length; i++) {
        const item = complete[i];
        const content = await fetchArtifactContent(item.jobId);
        if (content) triggerDownload(content, item.topic, item.jobId);
        setExportProgress({ done: i + 1, total: complete.length });
        if (i < complete.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setExportingAll(false);
      setExportProgress(null);
    }
  };

  const completeCount = items.filter((i) => i.status === "complete").length;

  return (
    <div
      className="rounded-lg overflow-hidden mt-2"
      style={{
        background: "linear-gradient(135deg, rgba(230, 245, 255, 0.7), rgba(0, 0, 0, 0.05))",
        backdropFilter: "blur(15px) saturate(180%)",
        WebkitBackdropFilter: "blur(15px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.3)",
        boxSizing: "border-box",
        maxWidth: "90vw",
        margin: "0 auto",
        overflowX: "hidden",
      }}
    >
      {/* Header row */}
      <div className="flex items-center w-full bg-muted/40">
        <button
          type="button"
          className="flex-1 flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground">Artifact History</span>
          {items.length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
              {items.length}
            </Badge>
          )}
        </button>

        {/* Export All button — only when there are complete artifacts */}
        {completeCount > 0 && (
          <button
            type="button"
            disabled={exportingAll}
            onClick={handleExportAll}
            title={`Export all ${completeCount} completed artifact${completeCount !== 1 ? "s" : ""}`}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 mr-1 rounded text-[10px] font-medium transition-colors",
              "text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20",
              exportingAll && "opacity-60 cursor-not-allowed"
            )}
          >
            {exportingAll ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{exportProgress ? `${exportProgress.done}/${exportProgress.total}` : "…"}</span>
              </>
            ) : (
              <>
                <Archive className="w-3 h-3" />
                <span>All ({completeCount})</span>
              </>
            )}
          </button>
        )}

        <button
          type="button"
          className="px-2 py-2 hover:bg-muted/60 transition-colors"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="max-h-52 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Loading history…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-4 text-center px-3">
              <p className="text-[10px] text-muted-foreground">
                No artifacts yet. Use{" "}
                <span className="font-mono text-emerald-600 dark:text-emerald-400">/full [topic]</span>{" "}
                to generate one.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => {
                const isComplete = item.status === "complete";
                const isThisDownloading = downloadingId === item.jobId;
                return (
                  <div
                    key={item.jobId}
                    className="flex items-center gap-1 px-3 py-2 transition-colors hover:bg-muted/30"
                  >
                    {/* Clickable info area — loads artifact into chat */}
                    <button
                      type="button"
                      disabled={!isComplete}
                      onClick={() => handleSelect(item)}
                      className={cn(
                        "flex-1 flex items-start gap-2 text-left min-w-0",
                        isComplete ? "cursor-pointer" : "cursor-default opacity-70"
                      )}
                    >
                      <StatusIcon status={item.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground truncate leading-snug">
                          {item.topic}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.status === "building" ? (
                            <span className="text-[9px] text-amber-500 dark:text-amber-400">
                              {item.sectionsCompleted}/{item.totalSections || "?"} sections
                            </span>
                          ) : isComplete ? (
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400">
                              {item.charCount.toLocaleString()} chars · {item.sectionsCompleted} sections
                            </span>
                          ) : (
                            <span className="text-[9px] text-destructive truncate max-w-[160px]">
                              {item.error ?? "Failed"}
                            </span>
                          )}
                          <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Per-row download button — always rendered */}
                    <button
                      type="button"
                      disabled={!isComplete || isThisDownloading}
                      onClick={(e) => handleDownloadOne(e, item)}
                      title={isComplete ? "Download .md" : "Not ready yet"}
                      className={cn(
                        "shrink-0 p-1.5 rounded transition-colors",
                        isComplete && !isThisDownloading
                          ? "text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 cursor-pointer"
                          : "text-muted-foreground/30 cursor-not-allowed"
                      )}
                    >
                      {isThisDownloading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
