import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Settings as SettingsIcon,
  Shield,
  Database,
  Palette,
  Brain,
  Trash2,
  Download,
  AlertTriangle,
  Check,
  Moon,
  Sun,
  Monitor,
  Cookie,
  FileText,
  ExternalLink,
  Cpu,
  KeyRound,
  Activity,
  RefreshCw,
  ShieldCheck,
  Lock,
  Mail,
  Clock,
  ClipboardList,
  Search,
  UserX,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store";
import { ModeSelector } from "@/components/ModeSelector";
import { SynthesisStatsPanel } from "@/components/SynthesisStatsPanel";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  APP_NAME, 
  LAST_UPDATED,
  DEFAULT_DATA_RETENTION_DAYS
} from "@/lib/constants";

export default function Settings() {
  const { 
    theme, 
    setTheme,
    consent,
    setConsent,
    sessionId,
    dataRetentionOptOut,
    setDataRetentionOptOut,
    learningEnabled,
    setLearningEnabled,
    resetAllData,
    activeModes,
    primaryMode
  } = useAppStore();
  
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showOptOutDialog, setShowOptOutDialog] = useState(false);
  const [showDeletionRequestDialog, setShowDeletionRequestDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionMessage, setDeletionMessage] = useState("");
  const [adminTokenInput, setAdminTokenInput] = useState("");
  const [activeAdminToken, setActiveAdminToken] = useState("");
  const [consentSessionId, setConsentSessionId] = useState("");
  const [sessionConsentRecord, setSessionConsentRecord] = useState<{
    consent_id: string;
    session_id: string | null;
    consent_date: string | null;
    consent_last_updated: string | null;
    essential_cookies: boolean;
    analytics_cookies: boolean;
    functional_cookies: boolean;
    data_retention: boolean;
    marketing_communications: boolean;
    third_party_sharing: boolean;
    session_created_at: string | null;
    learning_data_acknowledged: boolean | null;
    learning_data_acknowledged_at: string | null;
    age_verified: boolean | null;
    is_over_18: boolean | null;
    data_retention_opt_out: boolean | null;
  } | null>(null);
  const [sessionLookupError, setSessionLookupError] = useState<string | null>(null);
  const [sessionLookupLoading, setSessionLookupLoading] = useState(false);
  const [consentSearchResults, setConsentSearchResults] = useState<typeof sessionConsentRecord[] | null>(null);
  const [consentSearchLoading, setConsentSearchLoading] = useState(false);
  const [consentSearchError, setConsentSearchError] = useState<string | null>(null);
  const [adminDeleteDialogSession, setAdminDeleteDialogSession] = useState<string | null>(null);
  const [adminDeleteLoading, setAdminDeleteLoading] = useState(false);
  const { toast } = useToast();

  const {
    data: adminDeletionRequests,
    isFetching: deletionRequestsFetching,
    refetch: refetchAdminDeletionRequests,
  } = useQuery({
    queryKey: ["admin-deletion-requests", activeAdminToken],
    queryFn: async () => {
      const res = await fetch("/api/admin/deletion-requests", {
        headers: { "X-Admin-Token": activeAdminToken },
      });
      if (res.status === 401) throw new Error("Invalid admin token");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      return res.json() as Promise<{
        success: boolean;
        count: number;
        requests: Array<{
          id: string;
          sessionId: string;
          status: string;
          requestedAt: string;
          completedAt: string | null;
          userMessage: string | null;
        }>;
      }>;
    },
    enabled: activeAdminToken.length > 0,
    retry: false,
  });

  const markDeletionMutation = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: string }) => {
      const res = await fetch(`/api/admin/deletion-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Token": activeAdminToken },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      refetchAdminDeletionRequests();
      toast({
        title: "Request Updated",
        description: `Deletion request marked as ${variables.status}.`,
      });
    },
    onError: () => {
      toast({ title: "Update Failed", description: "Could not update the deletion request.", variant: "destructive" });
    },
  });

  const {
    data: learningHealth,
    isFetching: learningFetching,
    isError: learningError,
    refetch: refetchLearning,
  } = useQuery({
    queryKey: ["admin-learning-health", activeAdminToken],
    queryFn: async () => {
      const res = await fetch("/api/health/learning", {
        headers: { "X-Admin-Token": activeAdminToken },
      });
      if (res.status === 401) throw new Error("Invalid admin token");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      return res.json();
    },
    enabled: activeAdminToken.length > 0,
    refetchInterval: 30000,
    retry: false,
  });

  const handleAdminConnect = () => {
    if (!adminTokenInput.trim()) return;
    setActiveAdminToken(adminTokenInput.trim());
  };

  const handleAdminDisconnect = () => {
    setActiveAdminToken("");
    setAdminTokenInput("");
    setConsentSessionId("");
    setSessionConsentRecord(null);
    setSessionLookupError(null);
    setConsentSearchResults(null);
    setConsentSearchError(null);
    setAdminDeleteDialogSession(null);
  };

  const handleConsentSearch = async () => {
    setConsentSearchLoading(true);
    setConsentSearchError(null);
    setConsentSearchResults(null);
    setSessionConsentRecord(null);
    setSessionLookupError(null);

    try {
      const params = new URLSearchParams({ limit: "25" });
      if (consentSessionId.trim()) {
        params.set("session_id_search", consentSessionId.trim());
      }
      const res = await fetch(`/api/admin/consent-audit?${params.toString()}`, {
        headers: { "X-Admin-Token": activeAdminToken },
      });
      if (res.status === 401) {
        setConsentSearchError("Invalid admin token. Disconnect and try again.");
        setActiveAdminToken("");
        return;
      }
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const payload = await res.json();
      if (!payload?.success) throw new Error(payload?.error ?? "Server error");
      setConsentSearchResults(payload.records ?? []);
    } catch (err: unknown) {
      setConsentSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setConsentSearchLoading(false);
    }
  };

  const handleAdminDeleteSession = async (sessionId: string) => {
    setAdminDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: { "X-Admin-Token": activeAdminToken },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed: ${res.status}`);
      }
      toast({
        title: "Session Deleted",
        description: `All data for session …${sessionId.slice(-12)} permanently erased (GDPR Art. 17).`,
      });
      if (sessionConsentRecord?.session_id === sessionId) setSessionConsentRecord(null);
      if (consentSearchResults) {
        setConsentSearchResults(consentSearchResults.filter((r) => r?.session_id !== sessionId));
      }
      setAdminDeleteDialogSession(null);
      refetchAdminDeletionRequests();
    } catch (err: unknown) {
      toast({
        title: "Delete Failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setAdminDeleteLoading(false);
    }
  };

  const handleSessionLookup = async () => {
    const sessionId = consentSessionId.trim();
    if (!sessionId) {
      setSessionLookupError("Enter a session id to search.");
      setSessionConsentRecord(null);
      return;
    }

    setSessionLookupLoading(true);
    setSessionLookupError(null);
    setSessionConsentRecord(null);

    try {
      const res = await fetch(`/api/admin/consent-audit?session_id=${encodeURIComponent(sessionId)}&limit=1`, {
        headers: { "X-Admin-Token": activeAdminToken },
      });

      if (res.status === 401) {
        setSessionLookupError("Invalid admin token. Disconnect and try again.");
        setActiveAdminToken("");
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `Server error ${res.status}`);
      }

      const payload = await res.json();
      if (!payload?.success) {
        throw new Error(payload?.error ?? "No response from server");
      }

      if (Array.isArray(payload.records) && payload.records.length > 0) {
        setSessionConsentRecord(payload.records[0]);
      } else {
        setSessionLookupError("No consent record found for that session id.");
      }
    } catch (err: unknown) {
      setSessionLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionLookupLoading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/privacy/delete-data', {});
      return res.json();
    },
    onSuccess: () => {
      resetAllData();
      setShowDeleteDialog(false);
      toast({
        title: "All Data Deleted",
        description: "Your data has been permanently wiped. Returning to home…",
      });
      setTimeout(() => {
        window.location.href = '/';
      }, 1800);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Delete Failed",
        description: `Could not delete data: ${msg}`,
        variant: "destructive",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('GET', '/api/privacy/export-data', undefined);
      return await response.json();
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `betagrace-data-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Export Complete",
        description: "Your data has been downloaded as JSON.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    },
  });

  const { data: deletionStatus, refetch: refetchDeletionStatus } = useQuery({
    queryKey: ["deletion-request-status", sessionId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/privacy/deletion-request", undefined);
      return res.json() as Promise<{
        exists: boolean;
        requestId?: string;
        status?: string;
        requestedAt?: string;
        completedAt?: string | null;
      }>;
    },
    enabled: !!sessionId,
    staleTime: 1000 * 60 * 5,
  });

  const submitDeletionRequestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/privacy/deletion-request", {
        reason: deletionReason,
        userMessage: deletionMessage.trim() || undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Request failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      setShowDeletionRequestDialog(false);
      setDeletionReason("");
      setDeletionMessage("");
      refetchDeletionStatus();
      toast({
        title: "Deletion Request Submitted",
        description: "Your request has been logged. The administrator will process it within 30 days as required by GDPR Article 17.",
      });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Request Failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  const zipExportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('GET', '/api/privacy/export-data/zip', undefined);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      return await response.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `betagrace-data-export-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "ZIP Export Complete",
        description: "Your full data package (6 files + README) has been downloaded.",
      });
    },
    onError: () => {
      toast({
        title: "ZIP Export Failed",
        description: "Could not generate your data package. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleOptOut = () => {
    setDataRetentionOptOut(true);
    if (consent) {
      setConsent({
        ...consent,
        dataRetention: false,
        lastUpdated: new Date().toISOString(),
      });
    }
    setShowOptOutDialog(false);
    toast({
      title: "Opted Out",
      description: "You have opted out of data retention. Your conversation data will not be stored.",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {APP_NAME}
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="mb-8 space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <SettingsIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
              <p className="text-muted-foreground text-sm">
                Manage your privacy, preferences, and data
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="privacy" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="privacy" data-testid="tab-privacy">
              <Shield className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Privacy</span>
            </TabsTrigger>
            <TabsTrigger value="data" data-testid="tab-data">
              <Database className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Data</span>
            </TabsTrigger>
            <TabsTrigger value="modes" data-testid="tab-modes">
              <Brain className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Modes</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" data-testid="tab-appearance">
              <Palette className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Look</span>
            </TabsTrigger>
            <TabsTrigger value="engine" data-testid="tab-engine">
              <Cpu className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Engine</span>
            </TabsTrigger>
            <TabsTrigger value="admin" data-testid="tab-admin" className="relative">
              <KeyRound className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Admin</span>
              {activeAdminToken && learningHealth && !learningError && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Privacy Tab */}
          <TabsContent value="privacy" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cookie className="w-5 h-5" />
                  Cookie Preferences
                </CardTitle>
                <CardDescription>
                  Manage how we use cookies and similar technologies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Essential Cookies</Label>
                    <p className="text-xs text-muted-foreground">Required for basic functionality</p>
                  </div>
                  <Switch checked disabled />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Analytics Cookies</Label>
                    <p className="text-xs text-muted-foreground">Help us improve the service</p>
                  </div>
                  <Switch 
                    checked={consent?.analyticsCookies ?? false}
                    onCheckedChange={(checked) => {
                      if (consent) {
                        setConsent({ ...consent, analyticsCookies: checked, lastUpdated: new Date().toISOString() });
                      }
                    }}
                    data-testid="switch-analytics"
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Functional Cookies</Label>
                    <p className="text-xs text-muted-foreground">Remember your preferences</p>
                  </div>
                  <Switch 
                    checked={consent?.functionalCookies ?? true}
                    onCheckedChange={(checked) => {
                      if (consent) {
                        setConsent({ ...consent, functionalCookies: checked, lastUpdated: new Date().toISOString() });
                      }
                    }}
                    data-testid="switch-functional"
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Information Sharing</Label>
                    <p className="text-xs text-muted-foreground">Allow sharing with service providers and analytics</p>
                  </div>
                  <Switch 
                    checked={consent?.thirdPartySharing ?? false}
                    onCheckedChange={(checked) => {
                      if (consent) {
                        setConsent({ ...consent, thirdPartySharing: checked, lastUpdated: new Date().toISOString() });
                      }
                    }}
                    data-testid="switch-information-sharing"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  Parallel Learning
                </CardTitle>
                <CardDescription>
                  Allow {APP_NAME} to learn from your conversations to improve responses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Enable Learning</Label>
                    <p className="text-xs text-muted-foreground">
                      Anonymized patterns help improve AI quality
                    </p>
                  </div>
                  <Switch 
                    checked={learningEnabled}
                    onCheckedChange={setLearningEnabled}
                    data-testid="switch-learning"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Legal Documents
                </CardTitle>
                <CardDescription>
                  Review our privacy policy and terms of service
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link href="/privacy">
                  <Button variant="outline" className="w-full justify-between" data-testid="link-privacy-policy">
                    Privacy Policy
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/terms">
                  <Button variant="outline" className="w-full justify-between" data-testid="link-terms">
                    Terms of Service
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Data Retention
                </CardTitle>
                <CardDescription>
                  Control how long we store your conversation data
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Current Setting</p>
                    <p className="text-sm text-muted-foreground">
                      {dataRetentionOptOut 
                        ? "Opted out - no data stored" 
                        : `Data retained for ${DEFAULT_DATA_RETENTION_DAYS} days`
                      }
                    </p>
                  </div>
                  <Badge variant={dataRetentionOptOut ? "destructive" : "default"}>
                    {dataRetentionOptOut ? "Opted Out" : "Active"}
                  </Badge>
                </div>

                {!dataRetentionOptOut && (
                  <Dialog open={showOptOutDialog} onOpenChange={setShowOptOutDialog}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950" data-testid="button-opt-out">
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        Opt Out of Data Retention
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Opt Out of Data Retention</DialogTitle>
                        <DialogDescription>
                          This will prevent us from storing your conversation data. You will lose access to conversation history and some personalization features.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <p className="text-sm text-muted-foreground">
                          By opting out:
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          <li>• Your conversations will not be saved</li>
                          <li>• You cannot access previous conversations</li>
                          <li>• Personalization features will be limited</li>
                          <li>• This choice complies with your privacy rights</li>
                        </ul>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowOptOutDialog(false)}>
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleOptOut} data-testid="button-confirm-opt-out">
                          Confirm Opt-Out
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Export Your Data
                </CardTitle>
                <CardDescription>
                  Download a portable copy of all your data — GDPR Article 20 compliant
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => zipExportMutation.mutate()}
                  disabled={zipExportMutation.isPending || exportMutation.isPending}
                  data-testid="button-export-data-zip"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {zipExportMutation.isPending ? "Building ZIP..." : "Download Full Data Package (.zip)"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Includes session, conversations, messages, consent, learning data &amp; memory — 6 files + README
                </p>
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => exportMutation.mutate()}
                  disabled={exportMutation.isPending || zipExportMutation.isPending}
                  data-testid="button-export-data"
                >
                  <FileText className="w-3 h-3 mr-2" />
                  {exportMutation.isPending ? "Exporting..." : "Export as JSON only"}
                </Button>
              </CardContent>
            </Card>

            {/* GDPR Article 17 — Right to Erasure — Deletion Request */}
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                  <ClipboardList className="w-5 h-5" />
                  Request Account Deletion
                </CardTitle>
                <CardDescription>
                  Submit a formal erasure request under GDPR Article 17 — Right to be Forgotten
                </CardDescription>
              </CardHeader>
              <CardContent>
                {deletionStatus?.exists ? (
                  <div className="space-y-3">
                    {deletionStatus.status === "completed" ? (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                        <Check className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-green-700 dark:text-green-400">Request Completed</p>
                          <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                            Your data has been erased.
                            {deletionStatus.completedAt && ` Completed ${new Date(deletionStatus.completedAt).toLocaleDateString()}.`}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
                        <Clock className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
                            Request {deletionStatus.status === "processing" ? "In Progress" : "Pending Review"}
                          </p>
                          <p className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">
                            Submitted {deletionStatus.requestedAt ? new Date(deletionStatus.requestedAt).toLocaleDateString() : "recently"}.
                            Under GDPR Art. 17, erasure must be completed within 30 days.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Request ID: <span className="font-mono">{deletionStatus.requestId}</span>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      This submits a formal, logged request to the administrator to permanently erase your account.
                      You will receive confirmation once completed — within 30 days as required by GDPR.
                    </p>
                    <Dialog open={showDeletionRequestDialog} onOpenChange={setShowDeletionRequestDialog}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
                          data-testid="button-request-deletion"
                        >
                          <Mail className="w-4 h-4 mr-2" />
                          Submit Deletion Request
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                            <ClipboardList className="w-5 h-5" />
                            Request Account Deletion
                          </DialogTitle>
                          <DialogDescription>
                            This sends a formal GDPR Article 17 erasure request to the administrator.
                            Your data will be deleted within 30 days.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="deletion-reason" className="text-sm font-medium">
                              Reason <span className="text-red-500">*</span>
                            </Label>
                            <Select value={deletionReason} onValueChange={setDeletionReason}>
                              <SelectTrigger id="deletion-reason" data-testid="select-deletion-reason">
                                <SelectValue placeholder="Select a reason…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="No longer wish to use the service">No longer wish to use the service</SelectItem>
                                <SelectItem value="Privacy concerns">Privacy concerns</SelectItem>
                                <SelectItem value="Data accuracy concerns">Data accuracy concerns</SelectItem>
                                <SelectItem value="Withdrawing consent">Withdrawing consent</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="deletion-message" className="text-sm font-medium">
                              Additional details <span className="text-muted-foreground text-xs">(optional)</span>
                            </Label>
                            <Textarea
                              id="deletion-message"
                              placeholder="Any additional context for your request…"
                              value={deletionMessage}
                              onChange={(e) => setDeletionMessage(e.target.value)}
                              rows={3}
                              maxLength={1000}
                              data-testid="textarea-deletion-message"
                            />
                            <p className="text-xs text-muted-foreground text-right">{deletionMessage.length}/1000</p>
                          </div>
                          <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 p-3">
                            <p className="text-xs text-orange-700 dark:text-orange-400">
                              <strong>Note:</strong> This request notifies the administrator and is logged with a timestamp.
                              You can also use "Delete All My Data" below for immediate self-service deletion.
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setShowDeletionRequestDialog(false)}>
                            Cancel
                          </Button>
                          <Button
                            onClick={() => submitDeletionRequestMutation.mutate()}
                            disabled={!deletionReason || submitDeletionRequestMutation.isPending}
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                            data-testid="button-confirm-deletion-request"
                          >
                            {submitDeletionRequestMutation.isPending ? "Submitting…" : "Submit Request"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-red-200 dark:border-red-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <Trash2 className="w-5 h-5" />
                  Delete All Data
                </CardTitle>
                <CardDescription>
                  Permanently delete all your data from our systems
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="w-full" data-testid="button-delete-data">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All My Data
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="text-red-600">Delete All Data</DialogTitle>
                      <DialogDescription>
                        This action cannot be undone. All your conversations, preferences, and account data will be permanently deleted.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30">
                        <CardContent className="pt-4">
                          <p className="text-sm text-red-700 dark:text-red-400">
                            <strong>Warning:</strong> This will delete:
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-red-600 dark:text-red-500">
                            <li>• All conversation history</li>
                            <li>• Your preferences and settings</li>
                            <li>• Cookie consent records</li>
                            <li>• Learning data associated with your session</li>
                          </ul>
                        </CardContent>
                      </Card>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                        Cancel
                      </Button>
                      <Button 
                        variant="destructive" 
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                        data-testid="button-confirm-delete"
                      >
                        {deleteMutation.isPending ? "Deleting..." : "Delete Everything"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Modes Tab */}
          <TabsContent value="modes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Active Modes</CardTitle>
                <CardDescription>
                  Select which writing modes are active. Exclusive modes (Flesh Architect, Sanctuary) 
                  cannot run simultaneously with each other.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ModeSelector variant="cards" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mode Information</CardTitle>
                <CardDescription>
                  Understanding how modes work together
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-500 mt-0.5" />
                  <div>
                    <p className="font-medium">Simultaneous Modes</p>
                    <p className="text-sm text-muted-foreground">
                      Standard, Faith, and Advanced Reasoning can run together with any other non-exclusive mode.
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="font-medium">Exclusive Modes</p>
                    <p className="text-sm text-muted-foreground">
                      Flesh Architect and Sanctuary modes are exclusive - activating one will deactivate the other.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Theme</CardTitle>
                <CardDescription>
                  Choose how {APP_NAME} looks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <Button
                    variant={theme === 'light' ? 'default' : 'outline'}
                    className="h-auto py-4 flex flex-col gap-2"
                    onClick={() => setTheme('light')}
                    data-testid="button-theme-light"
                  >
                    <Sun className="w-6 h-6" />
                    <span>Light</span>
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'default' : 'outline'}
                    className="h-auto py-4 flex flex-col gap-2"
                    onClick={() => setTheme('dark')}
                    data-testid="button-theme-dark"
                  >
                    <Moon className="w-6 h-6" />
                    <span>Dark</span>
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'default' : 'outline'}
                    className="h-auto py-4 flex flex-col gap-2"
                    onClick={() => setTheme('system')}
                    data-testid="button-theme-system"
                  >
                    <Monitor className="w-6 h-6" />
                    <span>System</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Engine Tab */}
          <TabsContent value="engine" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="w-5 h-5" />
                  Local Synthesis Engine
                </CardTitle>
                <CardDescription>
                  BM25 + MMR knowledge engine — learns from every cloud response and synthesizes
                  answers when providers are offline. Stats refresh every 30 seconds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SynthesisStatsPanel />
              </CardContent>
            </Card>

            <Card className="border-muted">
              <CardHeader>
                <CardTitle className="text-sm font-medium">How It Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">Observe</strong> — every successful Pollinations, Gemini, or HuggingFace response is scored for quality and stored in the BM25 inverted index (deduped via cosine similarity).</p>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">Retrieve</strong> — when cloud providers are offline, the engine uses Okapi BM25 over the inverted index to find the most semantically relevant past interactions in O(postings) time.</p>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">Synthesize</strong> — Maximal Marginal Relevance (MMR) selects a diverse, non-redundant set of sentences from the top-ranked interactions and composes a coherent response.</p>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">Distill</strong> — periodically, low-quality and stale interactions are pruned (quality × 0.65 + recency × 0.35) and the index is rebuilt. Force distill runs this immediately.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Admin Tab */}
          <TabsContent value="admin" className="space-y-6">
            {/* Token Gate */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5" />
                  Admin Authentication
                </CardTitle>
                <CardDescription>
                  Enter your admin token to access system health diagnostics. The token is never stored.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!activeAdminToken ? (
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Enter admin token…"
                      value={adminTokenInput}
                      onChange={(e) => setAdminTokenInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAdminConnect()}
                      data-testid="input-admin-token"
                      className="font-mono"
                    />
                    <Button onClick={handleAdminConnect} disabled={!adminTokenInput.trim()} data-testid="button-admin-connect">
                      <Lock className="w-4 h-4 mr-2" />
                      Connect
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">Admin session active</span>
                      {learningError && (
                        <Badge variant="destructive" className="text-xs">Invalid token</Badge>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={handleAdminDisconnect} data-testid="button-admin-disconnect">
                      Disconnect
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dashboard — only visible when token is active and valid */}
            {activeAdminToken && !learningError && (
              <>
                {/* Anti-Cascade Status */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="w-5 h-5" />
                        Learning Health Dashboard
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchLearning()}
                        disabled={learningFetching}
                        data-testid="button-admin-refresh"
                      >
                        <RefreshCw className={`w-4 h-4 ${learningFetching ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    <CardDescription>
                      Live counts from the database. Auto-refreshes every 30 s.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {learningFetching && !learningHealth ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading…
                      </div>
                    ) : learningHealth ? (
                      <>
                        {/* Anti-cascade badge */}
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <span className="text-sm font-medium">Anti-Cascade Protocol</span>
                          <Badge className="bg-green-600 text-white capitalize">
                            {learningHealth.antiCascadeProtocol}
                          </Badge>
                        </div>

                        <Separator />

                        {/* Learning Data counts */}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Learning Data</p>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="text-center p-3 bg-muted/40 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums">
                                {learningHealth.learningData?.total ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Total rows</p>
                            </div>
                            <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                                {learningHealth.learningData?.linkedToActiveSessions ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Active sessions</p>
                            </div>
                            <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                {learningHealth.learningData?.detachedFromDeletedSessions ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Preserved (detached)</p>
                            </div>
                          </div>
                        </div>

                        <Separator />

                        {/* Long-Term Memory counts */}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Long-Term Memory</p>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="text-center p-3 bg-muted/40 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums">
                                {learningHealth.longTermMemory?.total ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Total rows</p>
                            </div>
                            <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                                {learningHealth.longTermMemory?.linkedToActiveSessions ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Active sessions</p>
                            </div>
                            <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                              <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                                {learningHealth.longTermMemory?.detachedFromDeletedSessions ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">Preserved (detached)</p>
                            </div>
                          </div>
                        </div>

                        <Separator />

                        {/* Summary */}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Summary</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-muted/40 rounded-lg">
                              <p className="text-xs text-muted-foreground">Total preserved records</p>
                              <p className="text-xl font-bold tabular-nums mt-1">
                                {learningHealth.summary?.totalPreservedRecords ?? "—"}
                              </p>
                            </div>
                            <div className="p-3 bg-muted/40 rounded-lg">
                              <p className="text-xs text-muted-foreground">Oldest record</p>
                              <p className="text-sm font-medium mt-1 truncate">
                                {learningHealth.summary?.oldestRecord
                                  ? new Date(learningHealth.summary.oldestRecord).toLocaleDateString()
                                  : "None"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground text-right pt-1">
                          Last fetched: {learningHealth.timestamp ? new Date(learningHealth.timestamp).toLocaleTimeString() : "—"}
                        </p>
                      </>
                    ) : null}
                  </CardContent>
                </Card>

                {/* GDPR Article 17 — Deletion Requests Dashboard */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ClipboardList className="w-5 h-5" />
                        GDPR Deletion Requests
                        {adminDeletionRequests && (
                          <Badge variant="secondary" className="ml-1 tabular-nums">
                            {adminDeletionRequests.requests.filter(r => r.status === "pending" || r.status === "processing").length} pending
                          </Badge>
                        )}
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchAdminDeletionRequests()}
                        disabled={deletionRequestsFetching}
                        data-testid="button-admin-refresh-deletions"
                      >
                        <RefreshCw className={`w-4 h-4 ${deletionRequestsFetching ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    <CardDescription>
                      Article 17 — Right to Erasure. Process within 30 days of submission.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {deletionRequestsFetching && !adminDeletionRequests ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading…
                      </div>
                    ) : !adminDeletionRequests?.requests?.length ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No deletion requests on record
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {adminDeletionRequests.requests.map((req) => {
                          const isPending = req.status === "pending";
                          const isProcessing = req.status === "processing";
                          const isActionable = isPending || isProcessing;
                          const isMutating = markDeletionMutation.isPending &&
                            (markDeletionMutation.variables as any)?.requestId === req.id;
                          return (
                            <div
                              key={req.id}
                              className="rounded-lg border bg-muted/30 p-3 space-y-2"
                              data-testid={`deletion-request-row-${req.id}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge
                                      className={
                                        req.status === "completed"
                                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200"
                                          : req.status === "processing"
                                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200"
                                          : req.status === "failed"
                                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200"
                                          : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200"
                                      }
                                      variant="outline"
                                    >
                                      {req.status}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(req.requestedAt).toLocaleDateString()} {new Date(req.requestedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  </div>
                                  <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                                    Session: {req.sessionId}
                                  </p>
                                  {req.userMessage && (
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                                      "{req.userMessage.slice(0, 120)}{req.userMessage.length > 120 ? "…" : ""}"
                                    </p>
                                  )}
                                  {req.completedAt && (
                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                      Completed: {new Date(req.completedAt).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                                {isActionable && (
                                  <div className="flex flex-col gap-1 shrink-0">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
                                      disabled={isMutating}
                                      onClick={() => markDeletionMutation.mutate({ requestId: req.id, status: "completed" })}
                                      data-testid={`button-mark-complete-${req.id}`}
                                    >
                                      {isMutating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                                      {isMutating ? "…" : "Mark Complete"}
                                    </Button>
                                    {isPending && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-xs h-7 text-blue-600 dark:text-blue-400"
                                        disabled={isMutating}
                                        onClick={() => markDeletionMutation.mutate({ requestId: req.id, status: "processing" })}
                                        data-testid={`button-mark-processing-${req.id}`}
                                      >
                                        Mark Processing
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-xs h-7 text-red-500 dark:text-red-400"
                                      disabled={isMutating}
                                      onClick={() => markDeletionMutation.mutate({ requestId: req.id, status: "failed" })}
                                      data-testid={`button-mark-failed-${req.id}`}
                                    >
                                      Mark Failed
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Session Consent Lookup */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Lock className="w-5 h-5" />
                      Session Consent Activity
                    </CardTitle>
                    <CardDescription>
                      Search or look up sessions by ID. Delete session data to fulfill GDPR Art. 17 erasure requests.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Input row — Search (partial/all) + Lookup (exact) */}
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <Input
                        type="text"
                        placeholder="Session ID — leave blank to browse all…"
                        value={consentSessionId}
                        onChange={(e) => setConsentSessionId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (e.shiftKey) handleSessionLookup();
                            else handleConsentSearch();
                          }
                        }}
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        onClick={handleConsentSearch}
                        disabled={consentSearchLoading || sessionLookupLoading}
                        title="Search sessions (partial match or browse all)"
                      >
                        {consentSearchLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <><Search className="w-4 h-4 mr-1.5" />Search</>
                        )}
                      </Button>
                      <Button
                        onClick={handleSessionLookup}
                        disabled={!consentSessionId.trim() || sessionLookupLoading || consentSearchLoading}
                        title="Exact session ID lookup — shows full detail card"
                      >
                        {sessionLookupLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          "Lookup"
                        )}
                      </Button>
                    </div>

                    {/* Search error */}
                    {consentSearchError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300">
                        {consentSearchError}
                      </div>
                    )}

                    {/* Lookup error */}
                    {sessionLookupError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300">
                        {sessionLookupError}
                      </div>
                    )}

                    {/* Search results table */}
                    {consentSearchResults !== null && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">
                          {consentSearchResults.length === 0
                            ? "No sessions found."
                            : `${consentSearchResults.length} session${consentSearchResults.length !== 1 ? "s" : ""} found — click a row to view detail`}
                        </p>
                        {consentSearchResults.length > 0 && (
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b bg-muted/60">
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Session ID</th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Consent Date</th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Age Verified</th>
                                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {consentSearchResults.map((row, idx) => {
                                  const sid = row?.session_id ?? "";
                                  return (
                                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                      <td className="px-3 py-2 font-mono">
                                        <button
                                          className="text-left hover:underline text-foreground truncate max-w-[140px] block"
                                          title={sid}
                                          onClick={() => {
                                            setConsentSessionId(sid);
                                            setSessionConsentRecord(row as NonNullable<typeof sessionConsentRecord>);
                                            setConsentSearchResults(null);
                                          }}
                                        >
                                          {sid ? `${sid.slice(0, 20)}…` : "—"}
                                        </button>
                                      </td>
                                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                                        {row?.consent_date ? new Date(row.consent_date).toLocaleDateString() : "—"}
                                      </td>
                                      <td className="px-3 py-2 hidden sm:table-cell">
                                        <Badge variant={row?.age_verified ? "default" : "secondary"} className="text-xs">
                                          {row?.age_verified ? "Yes" : "No"}
                                        </Badge>
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {sid ? (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-xs h-6 px-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                                            onClick={() => setAdminDeleteDialogSession(sid)}
                                          >
                                            <Trash2 className="w-3 h-3 mr-1" />
                                            Delete
                                          </Button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Exact-lookup detail card */}
                    {sessionConsentRecord && (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border bg-muted/50 p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Session</p>
                            <p className="mt-2 font-semibold break-all text-sm">{sessionConsentRecord.session_id ?? "—"}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Consent date: {sessionConsentRecord.consent_date ? new Date(sessionConsentRecord.consent_date).toLocaleString() : "—"}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-muted/50 p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Consent</p>
                            <p className="mt-2 text-sm">Acknowledged: <strong>{sessionConsentRecord.learning_data_acknowledged ? "Yes" : "No"}</strong></p>
                            <p className="text-sm">Data retention opt-out: <strong>{sessionConsentRecord.data_retention_opt_out ? "Yes" : "No"}</strong></p>
                            <p className="text-sm">Age verified: <strong>{sessionConsentRecord.age_verified ? "Yes" : "No"}</strong></p>
                          </div>
                          <div className="rounded-xl border bg-muted/50 p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Consent Timestamps</p>
                            <p className="mt-2 text-sm">Consent date: <strong>{sessionConsentRecord.consent_date ? new Date(sessionConsentRecord.consent_date).toLocaleString() : "—"}</strong></p>
                            <p className="text-sm">Last updated: <strong>{sessionConsentRecord.consent_last_updated ? new Date(sessionConsentRecord.consent_last_updated).toLocaleString() : "—"}</strong></p>
                          </div>
                          <div className="rounded-xl border bg-muted/50 p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cookie Preferences</p>
                            <p className="mt-2 text-sm">Essential: <strong>{sessionConsentRecord.essential_cookies ? "Yes" : "No"}</strong></p>
                            <p className="text-sm">Analytics: <strong>{sessionConsentRecord.analytics_cookies ? "Yes" : "No"}</strong></p>
                            <p className="text-sm">Functional: <strong>{sessionConsentRecord.functional_cookies ? "Yes" : "No"}</strong></p>
                          </div>
                        </div>

                        {/* GDPR Art. 17 — Delete session data (only when session_id is non-null) */}
                        {sessionConsentRecord.session_id && (
                          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-sm font-medium flex items-center gap-1.5">
                                  <UserX className="w-4 h-4 text-red-500" />
                                  Delete Session Data
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Permanently erases messages and conversations for this session (GDPR Art. 17). Consent record and timestamps are retained as required legal audit evidence.
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="shrink-0 border-red-300 text-red-600 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                                onClick={() => setAdminDeleteDialogSession(sessionConsentRecord.session_id)}
                              >
                                <Trash2 className="w-3 h-3 mr-1.5" />
                                Delete Session
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {/* Admin Delete Session — confirmation dialog */}
            <Dialog
              open={adminDeleteDialogSession !== null}
              onOpenChange={(open) => { if (!open && !adminDeleteLoading) setAdminDeleteDialogSession(null); }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-500" />
                    Delete Session Data
                  </DialogTitle>
                  <DialogDescription className="space-y-2 pt-1">
                    <span className="block">
                      Are you sure you want to delete all data for this session?
                    </span>
                    <span className="block font-mono text-xs bg-muted rounded px-2 py-1.5 break-all select-all">
                      {adminDeleteDialogSession}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      This permanently erases all messages and conversations (GDPR Art. 17). The consent record and timestamps are retained as required legal audit evidence and cannot be removed from here.
                    </span>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    variant="ghost"
                    onClick={() => setAdminDeleteDialogSession(null)}
                    disabled={adminDeleteLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={adminDeleteLoading}
                    onClick={() => { if (adminDeleteDialogSession) handleAdminDeleteSession(adminDeleteDialogSession); }}
                  >
                    {adminDeleteLoading
                      ? <><RefreshCw className="w-3 h-3 mr-2 animate-spin" />Deleting…</>
                      : <><Trash2 className="w-3 h-3 mr-2" />Yes, Delete Session Data</>}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Show error state if token was rejected */}
            {activeAdminToken && learningError && (
              <Card className="border-red-200 dark:border-red-800">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-medium">Access Denied</p>
                      <p className="text-sm text-muted-foreground mt-0.5">The token you entered was rejected. Please disconnect and try again.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-8 text-center text-xs text-muted-foreground">
          <p>{APP_NAME} v2.0 • Last Updated: {LAST_UPDATED}</p>
          <p className="mt-1">Compliant with U.S. Federal Law</p>
        </div>
      </div>
    </div>
  );
}
