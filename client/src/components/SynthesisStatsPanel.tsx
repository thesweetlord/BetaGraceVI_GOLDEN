import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  RefreshCw,
  Zap,
  BookOpen,
  BarChart3,
  Clock,
  Layers,
  Hash,
  Cpu,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface SynthesisStats {
  status: string;
  schemaVersion: number;
  records: number;
  maxRecords: number;
  totalObservations: number;
  uniqueTerms: number;
  vocabularyDensity: number;
  avgDocLength: number;
  avgQuality: number;
  topTopics: Record<string, number>;
  topProviders: Record<string, number>;
  topModes: Record<string, number>;
  lastDistilled: string;
  memoryPath: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  pollinations: "bg-blue-500",
  gemini:       "bg-purple-500",
  huggingface:  "bg-orange-500",
  local:        "bg-gray-400",
};

const TOPIC_COLORS: Record<string, string> = {
  writing:    "bg-pink-500",
  code:       "bg-cyan-500",
  ai:         "bg-violet-500",
  science:    "bg-green-500",
  philosophy: "bg-amber-500",
  history:    "bg-yellow-600",
  faith:      "bg-sky-500",
  math:       "bg-red-500",
  current:    "bg-teal-500",
  creative:   "bg-rose-400",
  business:   "bg-indigo-500",
  health:     "bg-emerald-500",
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className={`p-2 rounded-md ${accent ?? "bg-primary/10"}`}>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold text-sm leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.round((value / Math.max(1, max)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="capitalize text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SynthesisStatsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [distillResult, setDistillResult] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ success: boolean; stats: SynthesisStats }>({
    queryKey: ["synthesis-stats"],
    queryFn: async () => {
      const res = await fetch("/api/synthesis/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const distillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/synthesis/distill", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["synthesis-stats"] });
      const s = result.stats as SynthesisStats;
      setDistillResult(`Distillation complete — ${s.records} records retained, ${s.uniqueTerms.toLocaleString()} terms indexed.`);
      toast({ title: "Distillation Complete", description: "Knowledge base pruned and reindexed." });
    },
    onError: (err) => {
      toast({
        title: "Distillation Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>Loading engine stats…</span>
      </div>
    );
  }

  if (isError || !data?.success) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="font-medium">Could not reach synthesis engine</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const stats = data.stats;
  const fillPct = Math.round((stats.records / stats.maxRecords) * 100);
  const qualityPct = Math.round(stats.avgQuality * 100);
  const topTopicEntries = Object.entries(stats.topTopics).slice(0, 6);
  const topProviderEntries = Object.entries(stats.topProviders);
  const topModeEntries = Object.entries(stats.topModes).slice(0, 5);
  const topProviderMax = Math.max(...topProviderEntries.map(([, v]) => v), 1);
  const topTopicMax = Math.max(...topTopicEntries.map(([, v]) => v), 1);

  const lastDistilledDate = new Date(stats.lastDistilled);
  const minutesAgo = Math.round((Date.now() - lastDistilledDate.getTime()) / 60_000);
  const distilledLabel =
    minutesAgo < 2  ? "just now"
    : minutesAgo < 60 ? `${minutesAgo}m ago`
    : minutesAgo < 1440 ? `${Math.round(minutesAgo / 60)}h ago`
    : `${Math.round(minutesAgo / 1440)}d ago`;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium text-green-600 dark:text-green-400">Engine Online</span>
          <Badge variant="outline" className="text-xs font-mono">
            schema v{stats.schemaVersion}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 px-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard icon={BookOpen}   label="Interactions"      value={stats.records.toLocaleString()} sub={`of ${stats.maxRecords.toLocaleString()} max`} />
        <StatCard icon={Hash}       label="Vocabulary"        value={stats.uniqueTerms.toLocaleString()} sub={`${stats.vocabularyDensity} terms/record`} />
        <StatCard icon={BarChart3}  label="Avg Quality"       value={`${qualityPct}%`} sub="scored at store time" />
        <StatCard icon={Layers}     label="Avg Doc Length"    value={`${stats.avgDocLength} tok`} sub="Welford online mean" />
      </div>

      {/* Knowledge base fill */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> Knowledge base capacity</span>
          <span className="font-medium tabular-nums">{fillPct}% full</span>
        </div>
        <Progress value={fillPct} className="h-2" />
        <p className="text-xs text-muted-foreground">
          {stats.records.toLocaleString()} stored · {stats.totalObservations.toLocaleString()} total observed
          {stats.totalObservations > stats.records ? ` (${(stats.totalObservations - stats.records).toLocaleString()} deduped / quality-filtered)` : ""}
        </p>
      </div>

      <Separator />

      {/* Topics + Providers side by side */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Top topics */}
        {topTopicEntries.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" /> Top Topics
            </p>
            <div className="space-y-2">
              {topTopicEntries.map(([topic, count]) => (
                <BarRow
                  key={topic}
                  label={topic}
                  value={count}
                  max={topTopicMax}
                  color={TOPIC_COLORS[topic] ?? "bg-primary"}
                />
              ))}
            </div>
          </div>
        )}

        {/* Provider breakdown */}
        {topProviderEntries.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Provider Sources
            </p>
            <div className="space-y-2">
              {topProviderEntries.map(([prov, count]) => (
                <BarRow
                  key={prov}
                  label={prov}
                  value={count}
                  max={topProviderMax}
                  color={PROVIDER_COLORS[prov] ?? "bg-primary"}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mode distribution */}
      {topModeEntries.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mode Distribution
            </p>
            <div className="flex flex-wrap gap-2">
              {topModeEntries.map(([mode, count]) => (
                <Badge key={mode} variant="secondary" className="gap-1.5 font-normal">
                  <span className="capitalize">{mode}</span>
                  <span className="text-muted-foreground font-mono text-xs">{count}</span>
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Last distilled + force distill */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4 shrink-0" />
          <span>Last distilled <strong className="text-foreground">{distilledLabel}</strong></span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => distillMutation.mutate()}
          disabled={distillMutation.isPending}
          className="shrink-0"
        >
          <Zap className={`w-3.5 h-3.5 mr-1.5 ${distillMutation.isPending ? "animate-pulse" : ""}`} />
          {distillMutation.isPending ? "Distilling…" : "Force Distill"}
        </Button>
      </div>

      {distillResult && (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 border">
          {distillResult}
        </p>
      )}

      <p className="text-xs text-muted-foreground/60 font-mono break-all">
        {stats.memoryPath}
      </p>
    </div>
  );
}
