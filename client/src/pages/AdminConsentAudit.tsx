import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  ShieldCheck,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Lock,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarRange,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SESSION_KEY = "betagrace-admin-token";
const PAGE_LIMIT = 50;

type AuditRecord = {
  session_id: string;
  created_at: string | null;
  learning_data_acknowledged: boolean;
  learning_data_acknowledged_at: string | null;
  age_verified: boolean;
  is_over_18: boolean | null;
  data_retention_opt_out: boolean;
};

type AuditResponse = {
  success: boolean;
  generatedAt: string;
  pagination: { page: number; limit: number; totalRows: number; totalPages: number };
  summary: { totalSessions: number; acknowledgedCount: number; pendingCount: number };
  records: AuditRecord[];
};

type Filters = {
  acknowledgedOnly: boolean;
  dateFrom: string;
  dateTo: string;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function shortId(id: string) {
  return id.length > 20 ? `…${id.slice(-16)}` : id;
}

function buildParams(p: number, filters: Filters, extra?: Record<string, string>) {
  const params: Record<string, string> = {
    page: String(p),
    limit: String(PAGE_LIMIT),
    ...extra,
  };
  if (filters.acknowledgedOnly) params.acknowledged_only = "true";
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  return new URLSearchParams(params);
}

export default function AdminConsentAudit() {
  const { toast } = useToast();
  const [token, setToken] = useState(() => (sessionStorage.getItem(SESSION_KEY) ?? "").trim());
  const [tokenInput, setTokenInput] = useState("");
  const [authenticated, setAuthenticated] = useState(false);

  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [csvLoading, setCsvLoading] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    acknowledgedOnly: false,
    dateFrom: "",
    dateTo: "",
  });
  const [pendingFilters, setPendingFilters] = useState<Filters>({
    acknowledgedOnly: false,
    dateFrom: "",
    dateTo: "",
  });

  const hasDateFilter = filters.dateFrom || filters.dateTo;

  const fetchData = useCallback(
    async (p: number, f: Filters, tkn: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/consent-audit?${buildParams(p, f)}`, {
          headers: { "x-admin-token": tkn },
        });
        if (res.status === 401) {
          setAuthenticated(false);
          sessionStorage.removeItem(SESSION_KEY);
          setToken("");
          toast({ title: "Invalid token", description: "Check your ADMIN_TOKEN and try again.", variant: "destructive" });
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const json: AuditResponse = await res.json();
        setData(json);
        setAuthenticated(true);
      } catch (err) {
        toast({ title: "Request failed", description: String(err), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedToken = tokenInput.trim();
    sessionStorage.setItem(SESSION_KEY, normalizedToken);
    setToken(normalizedToken);
    await fetchData(1, filters, normalizedToken);
  };

  useEffect(() => {
    if (token) fetchData(1, filters, token);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => {
    setFilters(pendingFilters);
    setPage(1);
    fetchData(1, pendingFilters, token);
  };

  const clearDateRange = () => {
    const next = { ...filters, dateFrom: "", dateTo: "" };
    setPendingFilters(next);
    setFilters(next);
    setPage(1);
    fetchData(1, next, token);
  };

  const handleAckToggle = (val: boolean) => {
    const next = { ...pendingFilters, acknowledgedOnly: val };
    setPendingFilters(next);
    setFilters(next);
    setPage(1);
    fetchData(1, next, token);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchData(newPage, filters, token);
  };

  const handleRefresh = () => fetchData(page, filters, token);

  const handleCsvDownload = async () => {
    setCsvLoading(true);
    try {
      const res = await fetch(
        `/api/admin/consent-audit?${buildParams(1, filters, { csv: "true", limit: "10000" })}`,
        { headers: { "x-admin-token": token } }
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `consent-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "CSV download failed", description: String(err), variant: "destructive" });
    } finally {
      setCsvLoading(false);
    }
  };

  if (!authenticated || !token) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-3 pb-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-center text-lg">Admin Access</CardTitle>
            <CardDescription className="text-center">
              Enter your <code className="text-xs bg-muted px-1 py-0.5 rounded">ADMIN_TOKEN</code> to view the consent audit log
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token-input">Admin Token</Label>
                <Input
                  id="token-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Paste your ADMIN_TOKEN here"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !tokenInput}>
                {loading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                Unlock Dashboard
              </Button>
            </form>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Token is stored in your browser session only and is never saved to disk.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, pagination, records, generatedAt } = data ?? {
    summary: { totalSessions: 0, acknowledgedCount: 0, pendingCount: 0 },
    pagination: { page: 1, limit: PAGE_LIMIT, totalRows: 0, totalPages: 1 },
    records: [],
    generatedAt: "",
  };

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to App
              </Button>
            </Link>
            <div className="hidden sm:flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span className="font-semibold">Consent Audit Log</span>
              <Badge variant="outline" className="text-xs">Admin</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={handleCsvDownload} disabled={csvLoading}>
              <Download className="w-4 h-4 mr-1.5" />
              {csvLoading ? "Downloading…" : "Export CSV"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                sessionStorage.removeItem(SESSION_KEY);
                setToken("");
                setAuthenticated(false);
                setData(null);
              }}
            >
              <Lock className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-center gap-4 pt-5 pb-5">
              <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalSessions.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  {hasDateFilter ? "Sessions in Range" : "Total Sessions"}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-5 pb-5">
              <div className="p-2.5 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.acknowledgedCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Acknowledged</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-5 pb-5">
              <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.pendingCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Not Acknowledged</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters bar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              {/* Date range */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
                  <CalendarRange className="w-4 h-4" />
                  <span>Date range</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="date-from" className="text-xs">From</Label>
                    <Input
                      id="date-from"
                      type="date"
                      className="h-8 text-xs w-36"
                      value={pendingFilters.dateFrom}
                      max={pendingFilters.dateTo || undefined}
                      onChange={(e) => setPendingFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="date-to" className="text-xs">To</Label>
                    <Input
                      id="date-to"
                      type="date"
                      className="h-8 text-xs w-36"
                      value={pendingFilters.dateTo}
                      min={pendingFilters.dateFrom || undefined}
                      onChange={(e) => setPendingFilters((f) => ({ ...f, dateTo: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs opacity-0 select-none">Apply</Label>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      onClick={applyFilters}
                      disabled={loading || (!pendingFilters.dateFrom && !pendingFilters.dateTo)}
                    >
                      Apply
                    </Button>
                  </div>
                  {hasDateFilter && (
                    <div className="space-y-1">
                      <Label className="text-xs opacity-0 select-none">Clear</Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-muted-foreground"
                        onClick={clearDateRange}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Ack toggle */}
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="ack-filter" className="text-sm cursor-pointer select-none">
                  Acknowledged only
                </Label>
                <Switch
                  id="ack-filter"
                  checked={filters.acknowledgedOnly}
                  onCheckedChange={handleAckToggle}
                />
              </div>
            </div>

            {/* Active filter badges */}
            {(hasDateFilter || filters.acknowledgedOnly) && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
                <span className="text-xs text-muted-foreground self-center">Active filters:</span>
                {filters.dateFrom && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    From: {filters.dateFrom}
                  </Badge>
                )}
                {filters.dateTo && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    To: {filters.dateTo}
                  </Badge>
                )}
                {filters.acknowledgedOnly && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Acknowledged only
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Session Records</CardTitle>
                {generatedAt && (
                  <CardDescription className="text-xs mt-0.5">
                    Generated {fmt(generatedAt)} · Showing {records.length} of {pagination.totalRows.toLocaleString()} rows
                  </CardDescription>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Session ID</TableHead>
                    <TableHead>Session Created</TableHead>
                    <TableHead>AI Learning Acknowledged</TableHead>
                    <TableHead>Acknowledged At</TableHead>
                    <TableHead>Age Verified</TableHead>
                    <TableHead className="pr-6">Data Retention</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Loading records…
                      </TableCell>
                    </TableRow>
                  ) : records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No records found
                        {(hasDateFilter || filters.acknowledgedOnly) && " for the selected filters"}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((r) => (
                      <TableRow key={r.session_id}>
                        <TableCell className="pl-6 font-mono text-xs" title={r.session_id}>
                          {shortId(r.session_id)}
                        </TableCell>
                        <TableCell className="text-xs">{fmt(r.created_at)}</TableCell>
                        <TableCell>
                          {r.learning_data_acknowledged ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground gap-1">
                              <XCircle className="w-3 h-3" />
                              No
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{fmt(r.learning_data_acknowledged_at)}</TableCell>
                        <TableCell>
                          {r.age_verified ? (
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                              Verified
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-xs">
                          {r.data_retention_opt_out ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">Opted Out</span>
                          ) : (
                            <span className="text-muted-foreground">Enabled</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1 || loading}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= pagination.totalPages || loading}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
