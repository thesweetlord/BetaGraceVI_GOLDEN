import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  Loader2,
  Download,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ArtifactProgressCardProps {
  jobId: string;
  targetEndpoint: string;
  modeContext?: string;
}

type Phase = "pending" | "drafting" | "complete" | "error";

interface JobStatus {
  status: "building" | "complete" | "failed";
  topic?: string;
  sectionsCompleted?: number;
  totalSections?: number;
  currentSection?: string;
  artifact?: string | null;
  charCount?: number;
  error?: string;
}

export function ArtifactProgressCard({
  jobId,
  targetEndpoint,
  modeContext,
}: ArtifactProgressCardProps) {
  const [phase, setPhase] = useState<Phase>("pending");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [showArtifact, setShowArtifact] = useState(false);
  const consecutiveFailsRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(targetEndpoint, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { success: boolean; job?: JobStatus; error?: string } =
          await res.json();
        consecutiveFailsRef.current = 0;

        if (!data.success || !data.job) {
          setPhase("error");
          clearInterval(intervalRef.current!);
          return;
        }

        const job = data.job;
        setJobStatus(job);

        if (job.status === "building") {
          setPhase(
            job.sectionsCompleted && job.sectionsCompleted > 0
              ? "drafting"
              : "pending"
          );
        } else if (job.status === "complete") {
          setPhase("complete");
          if (job.artifact) setArtifactContent(job.artifact);
          clearInterval(intervalRef.current!);
        } else if (job.status === "failed") {
          setPhase("error");
          clearInterval(intervalRef.current!);
        }
      } catch {
        consecutiveFailsRef.current += 1;
        if (consecutiveFailsRef.current >= 3) {
          setPhase("error");
          clearInterval(intervalRef.current!);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [targetEndpoint]);

  const handleDownload = () => {
    if (!artifactContent) return;
    const blob = new Blob([artifactContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `artifact_${jobId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressPct =
    jobStatus?.totalSections && jobStatus.totalSections > 0
      ? Math.round(
          ((jobStatus.sectionsCompleted ?? 0) / jobStatus.totalSections) * 100
        )
      : 0;

  return (
    <Card className="border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/60 to-purple-50/40 dark:from-indigo-950/40 dark:to-purple-950/30 shadow-sm w-full max-w-lg">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
              phase === "complete"
                ? "bg-emerald-100 dark:bg-emerald-900/50"
                : phase === "error"
                  ? "bg-red-100 dark:bg-red-900/50"
                  : "bg-indigo-100 dark:bg-indigo-900/50"
            )}
          >
            {phase === "complete" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : phase === "error" ? (
              <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400" />
            ) : (
              <Loader2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">
              {phase === "pending" && "Artifact Generation Initiated…"}
              {phase === "drafting" &&
                jobStatus?.totalSections &&
                jobStatus.totalSections > 0
                ? `Drafting Section ${jobStatus.sectionsCompleted ?? 0} of ${jobStatus.totalSections}…`
                : phase === "drafting"
                  ? "Drafting artifact…"
                  : null}
              {phase === "complete" && "Artifact Complete"}
              {phase === "error" && "Generation Failed"}
            </p>
            {jobStatus?.topic && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {jobStatus.topic}
              </p>
            )}
          </div>

          {modeContext && (
            <Badge
              variant="outline"
              className="text-[10px] h-4 px-1.5 shrink-0 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
            >
              {modeContext}
            </Badge>
          )}
        </div>

        {/* Progress bar — visible while drafting */}
        {(phase === "pending" || phase === "drafting") && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-indigo-100 dark:bg-indigo-900/60 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  phase === "pending"
                    ? "w-[8%] bg-indigo-400 animate-pulse"
                    : "bg-gradient-to-r from-indigo-500 to-purple-500"
                )}
                style={
                  phase === "drafting" && progressPct > 0
                    ? { width: `${progressPct}%` }
                    : undefined
                }
              />
            </div>
            {phase === "drafting" && jobStatus?.currentSection && (
              <p className="text-[11px] text-muted-foreground truncate">
                {jobStatus.currentSection}
              </p>
            )}
          </div>
        )}

        {/* Complete state actions */}
        {phase === "complete" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="w-3 h-3 shrink-0" />
              <span>
                {jobStatus?.sectionsCompleted ?? 0} sections •{" "}
                {jobStatus?.charCount
                  ? `${(jobStatus.charCount / 1000).toFixed(1)}k chars`
                  : "complete"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => setShowArtifact((v) => !v)}
              >
                <ExternalLink className="w-3 h-3" />
                {showArtifact ? "Hide Manuscript" : "View Complete Artifact"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-indigo-300 dark:border-indigo-700"
                onClick={handleDownload}
              >
                <Download className="w-3 h-3" />
                Download .md
              </Button>
            </div>
            {showArtifact && artifactContent && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-indigo-200 dark:border-indigo-800 bg-background/80 p-3">
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground">
                  {artifactContent}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {jobStatus?.error ??
              "The artifact pipeline encountered an error. The standard response channel remains available."}
          </p>
        )}

        {/* Job ID footer */}
        <p className="text-[10px] text-muted-foreground/60 font-mono">
          job:{jobId}
        </p>
      </CardContent>
    </Card>
  );
}
