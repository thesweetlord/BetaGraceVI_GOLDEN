import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Library,
  Download,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  FileText,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ArtifactEntry {
  jobId: string;
  topic: string;
  status: "building" | "complete" | "failed";
  sectionsCompleted: number;
  totalSections: number;
  charCount: number;
  createdAt: string;
  error?: string;
}

interface ArtifactVaultDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatRelativeTime(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusIcon({ status }: { status: ArtifactEntry["status"] }) {
  if (status === "complete")
    return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "failed")
    return <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Loader2 className="w-4 h-4 text-amber-500 shrink-0 animate-spin" />;
}

async function fetchArtifactBlob(jobId: string): Promise<string | null> {
  const res = await fetch(`/api/academic/artifact/status/${jobId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    console.error("[VAULT] Artifact status request failed:", res.status, res.statusText);
    return null;
  }
  const data = await res.json();
  const artifact = data.artifact ?? data.job?.artifact;
  if (!artifact) {
    console.error("[VAULT] Artifact payload missing:", data);
    return null;
  }
  return artifact as string;
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadArtifact(jobId: string, topic: string) {
  const content = await fetchArtifactBlob(jobId);
  if (!content) return;
  const filename = `${topic.slice(0, 40).replace(/[^a-z0-9]/gi, "_")}_${jobId}.md`;
  triggerDownload(content, filename);
}

export function ArtifactVaultDialog({ isOpen, onClose }: ArtifactVaultDialogProps) {
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch("/api/academic/artifacts/history", {
          credentials: "include",
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "(no body)");
          const msg = `Vault_Fetch_Failed: HTTP ${res.status} ${res.statusText} — ${errText.slice(0, 200)}`;
          console.error("[CRITICAL_VAULT_ERROR]", msg);
          setError(`Server error ${res.status} — check the console for details.`);
          return;
        }
        const data = await res.json();
        if (data.success) {
          setArtifacts(data.artifacts ?? []);
        } else {
          const serverMsg = data.error ?? "Unknown server error";
          console.error("[CRITICAL_VAULT_ERROR] success=false:", serverMsg);
          setError(`Failed to load vault: ${serverMsg}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[CRITICAL_VAULT_ERROR]", msg);
        setError(`Network error — ${msg}`);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [isOpen]);

  const completeArtifacts = artifacts.filter((a) => a.status === "complete");

  async function handleDownloadOne(artifact: ArtifactEntry) {
    if (artifact.status !== "complete") return;
    setDownloadingId(artifact.jobId);
    try {
      await downloadArtifact(artifact.jobId, artifact.topic);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleExportAll() {
    if (exportingAll || completeArtifacts.length === 0) return;
    setExportingAll(true);
    setExportProgress({ done: 0, total: completeArtifacts.length });
    try {
      for (let i = 0; i < completeArtifacts.length; i++) {
        const a = completeArtifacts[i];
        await downloadArtifact(a.jobId, a.topic);
        setExportProgress({ done: i + 1, total: completeArtifacts.length });
        // Small gap so the browser doesn't block multiple simultaneous downloads
        if (i < completeArtifacts.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } finally {
      setExportingAll(false);
      setExportProgress(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        data-vault-modal="glassmorphic"
        className="max-w-2xl w-full rounded-2xl shadow-[0_0_60px_rgba(251,191,36,0.18),0_0_0_1px_rgba(251,191,36,0.12)] flex flex-col max-h-[85vh]"
        style={{
          background: "linear-gradient(135deg, rgba(230, 245, 255, 0.7), rgba(0, 0, 0, 0.05))",
          backdropFilter: "blur(15px) saturate(180%)",
          WebkitBackdropFilter: "blur(15px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.3)",
          boxSizing: "border-box",
          maxWidth: "90vw",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        <DialogHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-400/30">
                <Library className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-gray-900 dark:text-amber-100">
                  Artifact Vault
                </DialogTitle>
                <DialogDescription className="text-xs text-gray-500 dark:text-amber-300/70 mt-0.5">
                  Complete history of generated manuscripts
                </DialogDescription>
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-700 bg-amber-100 dark:border-amber-400/40 dark:text-amber-300 dark:bg-amber-500/10 text-[10px] shrink-0"
            >
              {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </DialogHeader>

        <Separator className="bg-gray-300 dark:bg-amber-400/20" />

        {/* Toolbar row — Export All button lives here, always shown when list is visible */}
        {!isLoading && !error && artifacts.length > 0 && (
          <div className="flex items-center justify-end pt-1 pb-0.5">
            <button
              type="button"
              onClick={() => !exportingAll && handleExportAll()}
              title={completeArtifacts.length === 0 ? "No completed artifacts to export" : `Export all ${completeArtifacts.length} completed`}
              style={completeArtifacts.length > 0 && !exportingAll
                ? { background: "#f59e0b", borderColor: "#d97706", color: "#ffffff" }
                : { background: "#ffffff", borderColor: "#9ca3af", color: "#9ca3af" }
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-opacity hover:opacity-80"
            >
              {exportingAll ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{exportProgress ? `${exportProgress.done}/${exportProgress.total}` : "Exporting…"}</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" />
                  <span>Export All ({completeArtifacts.length})</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Body — scrollable */}
        <div className="mt-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(245,158,11,0.4) transparent" }}>
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500 dark:text-amber-300/70">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading your vault…</span>
            </div>
          )}

          {!isLoading && error && (
            <div className="flex items-center gap-2 py-8 justify-center text-red-500 dark:text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {!isLoading && !error && artifacts.length === 0 && (
            <div className="flex flex-col items-center py-14 gap-3 text-gray-400 dark:text-amber-300/50">
              <FileText className="w-10 h-10 opacity-40" />
              <p className="text-sm">No artifacts generated yet.</p>
              <p className="text-xs opacity-60">
                Start a long-horizon task with{" "}
                <code className="bg-amber-500/10 px-1 rounded">/full [topic]</code>
              </p>
            </div>
          )}

          {!isLoading && !error && artifacts.length > 0 && (
            <div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                {artifacts.map((artifact) => {
                  const isComplete = artifact.status === "complete";
                  const isThisDownloading = downloadingId === artifact.jobId;
                  return (
                    <li
                      key={artifact.jobId}
                      className={cn(
                        "p-3 rounded-xl border transition-colors",
                        "bg-gray-200/70 border-gray-300 hover:bg-gray-200 hover:border-gray-400",
                        "dark:bg-amber-500/5 dark:border-amber-400/20 dark:hover:bg-amber-500/10 dark:hover:border-amber-400/35"
                      )}
                    >
                      {/* Top row: status icon + topic */}
                      <div className="flex items-start gap-2 mb-2">
                        <StatusIcon status={artifact.status} />
                        <p className="text-sm font-medium text-gray-900 dark:text-amber-100 leading-tight break-words min-w-0">
                          {artifact.topic}
                        </p>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2.5 pl-6">
                        <span className="text-[11px] text-gray-500 dark:text-amber-300/60">
                          {formatRelativeTime(artifact.createdAt)}
                        </span>
                        {isComplete && (
                          <>
                            <span className="text-gray-400 dark:text-amber-400/30">·</span>
                            <span className="text-[11px] text-gray-500 dark:text-amber-300/60">
                              {artifact.sectionsCompleted} sections
                            </span>
                            <span className="text-gray-400 dark:text-amber-400/30">·</span>
                            <span className="text-[11px] text-gray-500 dark:text-amber-300/60">
                              {(artifact.charCount / 1000).toFixed(1)}k chars
                            </span>
                          </>
                        )}
                        {artifact.status === "building" && (
                          <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-400/50 border dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-400/30">
                            building
                          </Badge>
                        )}
                        {artifact.status === "failed" && (
                          <span className="text-[11px] text-red-500 dark:text-red-400/80">
                            {artifact.error ?? "Failed"}
                          </span>
                        )}
                      </div>

                      {/* Download button — own full-width row, cannot be clipped */}
                      <div className="pl-6">
                        <button
                          type="button"
                          onClick={() => isComplete && !isThisDownloading && handleDownloadOne(artifact)}
                          title={isComplete ? "Download .md" : "Not ready yet"}
                          style={isComplete
                            ? { background: "#f59e0b", borderColor: "#d97706", color: "#ffffff", cursor: "pointer" }
                            : { background: "#e5e7eb", borderColor: "#9ca3af", color: "#6b7280", cursor: "default" }
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold"
                        >
                          {isThisDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>{isComplete ? "Download .md" : "Pending"}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
