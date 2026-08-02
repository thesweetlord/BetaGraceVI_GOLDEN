import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Shield,
  AlertTriangle,
  User,
  Baby,
  Database,
  Brain,
  ArrowLeft,
  FileText,
  Loader2,
  Check,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/lib/store";
import { APP_NAME, COPPA_NOTICE } from "@/lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function AgeVerificationModal() {
  const {
    ageVerified,
    setAgeVerification,
    setSessionId,
    setDataRetentionOptOut,
    setLearningEnabled,
    dataRetentionOptOut,
    learningEnabled,
  } = useAppStore();
  const [step, setStep] = useState<"age" | "preferences" | "privacy">("age");
  const [keepDataRetention, setKeepDataRetention] =
    useState(!dataRetentionOptOut);
  const [enableLearning, setEnableLearning] = useState(learningEnabled);
  const [policyScrolled, setPolicyScrolled] = useState(false);
  const [learningDataAcknowledged, setLearningDataAcknowledged] =
    useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [privacyPolicyContent, setPrivacyPolicyContent] = useState("");
  const [termsOfServiceContent, setTermsOfServiceContent] = useState("");
  const [legalDocsLoading, setLegalDocsLoading] = useState(false);
  const [legalDocsError, setLegalDocsError] = useState<string | null>(null);
  const policyContentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const isPolicyAtBottom = () => {
    const contentEl = policyContentRef.current;
    if (!contentEl) return false;
    return (
      contentEl.scrollTop + contentEl.clientHeight >=
      contentEl.scrollHeight - 10
    );
  };

  const handleAgeSelection = (isOver18: boolean) => {
    if (isOver18) {
      setStep("preferences");
    } else {
      // User is under 18 - cannot use service
      window.location.href = "https://www.google.com";
    }
  };

  const handlePreferencesConfirm = () => {
    // Save preferences
    setDataRetentionOptOut(!keepDataRetention);
    setLearningEnabled(enableLearning);
    // Move to privacy step and reset scroll tracking
    setStep("privacy");
    setPolicyScrolled(false);
  };

  useEffect(() => {
    if (step !== "privacy") return;

    let cancelled = false;

    const fetchLegalDocs = async () => {
      setLegalDocsLoading(true);
      setLegalDocsError(null);

      try {
        const [privacyResponse, termsResponse] = await Promise.all([
          fetch("/api/privacy-policy"),
          fetch("/api/terms-of-service"),
        ]);

        if (!privacyResponse.ok) {
          throw new Error("Failed to load privacy policy");
        }

        if (!termsResponse.ok) {
          throw new Error("Failed to load terms of service");
        }

        const [privacyMarkdown, termsMarkdown] = await Promise.all([
          privacyResponse.text(),
          termsResponse.text(),
        ]);

        if (cancelled) return;

        setPrivacyPolicyContent(privacyMarkdown);
        setTermsOfServiceContent(termsMarkdown);
      } catch (error) {
        if (cancelled) return;
        setLegalDocsError(
          error instanceof Error
            ? error.message
            : "Failed to load legal documents",
        );
      } finally {
        if (!cancelled) {
          setLegalDocsLoading(false);
        }
      }
    };

    void fetchLegalDocs();

    return () => {
      cancelled = true;
    };
  }, [step]);

  // Monitor scroll position on policy content + auto-scroll to reveal content
  useEffect(() => {
    const contentEl = policyContentRef.current;
    if (!contentEl || step !== "privacy") return;

    const handleScroll = () => {
      setPolicyScrolled(isPolicyAtBottom());
    };

    handleScroll();
    contentEl.addEventListener("scroll", handleScroll, { passive: true });

    // Auto-mark as scrolled after a short read delay so button is always usable
    const timer = setTimeout(() => setPolicyScrolled(true), 2500);

    return () => {
      contentEl.removeEventListener("scroll", handleScroll);
      clearTimeout(timer);
    };
  }, [step, legalDocsLoading, privacyPolicyContent, termsOfServiceContent]);

  const handlePrivacyAccept = async () => {
    setIsSubmitting(true);
    try {
      // STEP 1: INITIALIZE SESSION FIRST (CRITICAL - must happen before age verification)
      // This ensures backend creates session with correct sessionId from header
      const sessionInitResponse = await apiRequest("POST", "/api/session", {});
      const sessionInitData = await sessionInitResponse.json();

      // Extract and store sessionId from initialization response
      let sessionId = sessionInitData?.session?.id ?? sessionInitData?.id;
      if (sessionId) {
        setSessionId(sessionId);
        localStorage.setItem("betagrace-sessionId", sessionId);

        try {
          const stored = localStorage.getItem("betagrace-storage");
          const parsed = stored ? JSON.parse(stored) : { state: {} };
          parsed.state = parsed.state || {};
          parsed.state.sessionId = sessionId;
          localStorage.setItem("betagrace-storage", JSON.stringify(parsed));
        } catch {
          // silently ignore malformed storage
        }
      }

      // STEP 2: VERIFY AGE (now that session exists on backend)
      // Backend will find the session and update it with isOver18=true
      const verifyResponse = await apiRequest(
        "POST",
        "/api/session/verify-age",
        {
          isOver18: true,
          learningDataAcknowledged: true,
          dataRetentionOptOut: !keepDataRetention,
        },
      );
      const verifyData = await verifyResponse.json();

      // Extract updated session from verification response
      if (verifyData.session?.id) {
        setSessionId(verifyData.session.id);
        localStorage.setItem("betagrace-sessionId", verifyData.session.id);
        // CRITICAL FIX: Directly save to localStorage to ensure it's available before next request
        // This bypasses Zustand persist timing issues
        try {
          const stored = localStorage.getItem("betagrace-storage");
          const parsed = stored ? JSON.parse(stored) : { state: {} };
          parsed.state = parsed.state || {};
          parsed.state.sessionId = verifyData.session.id;
          localStorage.setItem("betagrace-storage", JSON.stringify(parsed));
        } catch {
          // silently ignore malformed storage
        }
      }

      // Complete age verification locally
      setAgeVerification(true, true);
      setStep("age"); // Reset for future use
      setPolicyScrolled(false);

      toast({
        title: "Success",
        description: "Age verified. Welcome to BetaGrace!",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to verify age. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (ageVerified) return null;

  return (
    <Dialog
      open={!ageVerified}
      modal
      onOpenChange={(open) => {
        // SECURITY: Prevent closing modal without age verification
        if (!open && !ageVerified) {
          return;
        }
      }}
    >
      <DialogContent
        className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col"
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* STEP 1: AGE VERIFICATION */}
        {step === "age" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="bg-gradient-to-br from-primary/10 via-transparent to-accent/10 p-6 flex-shrink-0">
              <DialogHeader className="space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-primary" />
                </div>
                <DialogTitle className="text-2xl text-center font-semibold">
                  Welcome to {APP_NAME}
                </DialogTitle>
                <DialogDescription className="text-center text-base">
                  Age verification required. {APP_NAME} is restricted to users
                  18 years of age or older.
                </DialogDescription>
              </DialogHeader>
            </div>

            <CardContent className="p-6 space-y-6 flex-1 flex flex-col overflow-y-auto">
              <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    18+ Age Requirement
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <CardDescription className="text-xs text-red-600 dark:text-red-500">
                    {COPPA_NOTICE}
                  </CardDescription>
                </CardContent>
              </Card>

              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Are you 18 years of age or older?
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-auto py-6 flex flex-col gap-2 hover-elevate"
                  onClick={() => handleAgeSelection(true)}
                  data-testid="button-age-18-plus"
                >
                  <User className="w-8 h-8 text-primary" />
                  <span className="text-lg font-medium">Yes, 18+</span>
                  <span className="text-xs text-muted-foreground">
                    I am 18 years or older
                  </span>
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  className="h-auto py-6 flex flex-col gap-2 hover-elevate"
                  onClick={() => handleAgeSelection(false)}
                  data-testid="button-age-under-18"
                >
                  <Baby className="w-8 h-8 text-muted-foreground" />
                  <span className="text-lg font-medium">No, Under 18</span>
                  <span className="text-xs text-muted-foreground">
                    I am under 18 years old
                  </span>
                </Button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our{" "}
                <a
                  href="/terms"
                  className="text-primary hover:underline"
                  target="_blank"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="/privacy"
                  className="text-primary hover:underline"
                  target="_blank"
                >
                  Privacy Policy
                </a>
              </p>
            </CardContent>
          </div>
        )}

        {/* STEP 2: PRIVACY PREFERENCES */}
        {step === "preferences" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="bg-gradient-to-br from-blue-500/10 via-transparent to-purple-500/10 p-6 flex-shrink-0">
              <DialogHeader className="space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Shield className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <DialogTitle className="text-2xl text-center font-semibold">
                  Privacy Preferences
                </DialogTitle>
                <DialogDescription className="text-center text-base">
                  Choose how your data is handled (you can change these anytime
                  in Settings)
                </DialogDescription>
              </DialogHeader>
            </div>

            <CardContent className="p-6 space-y-6 flex-1 flex flex-col overflow-y-auto">
              {/* Data Retention Toggle */}
              <Card className="border-blue-200 dark:border-blue-800">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 mt-1">
                        <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-sm">
                          Data Retention
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Keep my conversation data for up to 30 days for
                          continuity
                        </CardDescription>
                      </div>
                    </div>
                    <Switch
                      checked={keepDataRetention}
                      onCheckedChange={setKeepDataRetention}
                      data-testid="toggle-data-retention"
                    />
                  </div>
                </CardHeader>
              </Card>

              {/* Learning Toggle */}
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 mt-1">
                        <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-sm">
                          Parallel Learning
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Enable AI to learn your writing style and preferences
                          for better responses
                        </CardDescription>
                      </div>
                    </div>
                    <Switch
                      checked={enableLearning}
                      onCheckedChange={setEnableLearning}
                      data-testid="toggle-learning"
                    />
                  </div>
                </CardHeader>
              </Card>

              <p className="text-xs text-center text-muted-foreground">
                All data is encrypted and never sold to third parties
              </p>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep("age")}
                  className="flex-1"
                  data-testid="button-back-preferences"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button
                  variant="default"
                  onClick={handlePreferencesConfirm}
                  className="flex-1"
                  data-testid="button-continue-preferences"
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </div>
        )}

        {/* STEP 3: PRIVACY POLICY ACCEPTANCE */}
        {step === "privacy" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 p-6 flex-shrink-0">
              <DialogHeader className="space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                </div>
                <DialogTitle className="text-2xl text-center font-semibold">
                  Privacy & Terms
                </DialogTitle>
                <DialogDescription className="text-center text-base">
                  Please read and accept our Privacy Policy and Terms of Service
                  to continue
                </DialogDescription>
              </DialogHeader>
            </div>

            <CardContent className="p-6 space-y-4 flex-1 flex flex-col overflow-y-auto">
              {/* Scroll tracking indicator */}
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3">
                {policyScrolled ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Policy reviewed - you may now accept</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    <span>Scroll to the bottom of the policy to accept</span>
                  </>
                )}
              </div>

              {/* Scrollable policy content */}
              <div
                ref={policyContentRef}
                className="h-72 border rounded-md p-4 bg-muted/30 overflow-y-auto text-sm"
              >
                {legalDocsLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center space-y-3 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      <p className="text-xs">
                        Loading current Privacy Policy and Terms of Service...
                      </p>
                    </div>
                  </div>
                ) : legalDocsError ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center space-y-3 max-w-sm">
                      <AlertTriangle className="w-5 h-5 mx-auto text-destructive" />
                      <p className="text-xs text-muted-foreground">
                        {legalDocsError}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Please review the full documents using the links below,
                        or try again by going back and reopening this step.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div>
                      <h3 className="font-semibold mb-3">
                        Current Privacy Policy
                      </h3>
                      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none break-words">
                        <ReactMarkdown>{privacyPolicyContent}</ReactMarkdown>
                      </div>
                    </div>

                    <div className="border-t pt-6">
                      <h3 className="font-semibold mb-3">
                        Current Terms of Service
                      </h3>
                      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none break-words">
                        <ReactMarkdown>{termsOfServiceContent}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* AI Learning Data acknowledgment checkbox */}
              <div className="flex items-start gap-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 p-3">
                <Checkbox
                  id="learning-data-ack"
                  checked={learningDataAcknowledged}
                  onCheckedChange={(v) => setLearningDataAcknowledged(!!v)}
                  data-testid="checkbox-learning-data-ack"
                  className="mt-0.5 shrink-0"
                />
                <Label
                  htmlFor="learning-data-ack"
                  className="text-xs leading-relaxed cursor-pointer text-amber-800 dark:text-amber-300"
                >
                  I understand and agree that{" "}
                  <strong>
                    BetaGrace retains all rights to save and use AI learning
                    data
                  </strong>{" "}
                  from my interactions, regardless of my data retention
                  settings, and that this data may be retained indefinitely.
                </Label>
              </div>

              {/* Accept button */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep("preferences")}
                  className="flex-1"
                  disabled={isSubmitting}
                  data-testid="button-back-privacy"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button
                  variant="default"
                  onClick={handlePrivacyAccept}
                  disabled={isSubmitting || !learningDataAcknowledged}
                  className="flex-1"
                  data-testid="button-accept-privacy"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Accept & Continue"
                  )}
                </Button>
              </div>
            </CardContent>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
