import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, FileText, Loader2, CheckCircle, ArrowDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { APP_NAME } from "@/lib/constants";

export default function TermsOfService() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchTermsOfService = async () => {
      try {
        const response = await fetch("/api/terms-of-service");
        if (!response.ok) {
          throw new Error("Failed to load terms of service");
        }
        const markdown = await response.text();
        setContent(markdown);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load terms of service");
      } finally {
        setLoading(false);
      }
    };

    fetchTermsOfService();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading terms of service...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <FileText className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Error Loading Terms of Service</h2>
            <p className="text-muted-foreground">{error}</p>
            <Link href="/">
              <Button>Back to {APP_NAME}</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {APP_NAME}
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 flex-1 flex flex-col w-full">
        <div className="text-center mb-8 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold" data-testid="text-terms-title">
            Terms of Service
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Please read these terms carefully before using {APP_NAME}. By accessing or using our service,
            you agree to be bound by these terms.
          </p>
        </div>

        {/* Scrollable content box */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto border rounded-lg p-6 bg-background/50 max-h-[55vh]"
          data-testid="tos-scroll-container"
        >
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>

        {/* Scroll-to-bottom hint */}
        {!hasScrolledToBottom && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Please scroll to the bottom to read all terms before accepting.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToBottom}
              data-testid="button-scroll-to-bottom"
            >
              <ArrowDown className="w-4 h-4 mr-2" />
              Scroll to Bottom
            </Button>
          </div>
        )}

        {/* Accept section — only visible after scrolling */}
        <div className="mt-6 border-t pt-6">
          {accepted ? (
            <div
              className="flex items-center justify-center gap-3 py-3 px-6 rounded-lg bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400"
              data-testid="tos-accepted-confirmation"
            >
              <CheckCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">
                Terms of Service accepted. You may now use {APP_NAME}.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {!hasScrolledToBottom && (
                <p className="text-xs text-muted-foreground text-center">
                  You must read all terms before accepting.
                </p>
              )}
              <Button
                disabled={!hasScrolledToBottom}
                onClick={() => setAccepted(true)}
                className="w-full max-w-sm"
                data-testid="button-accept-tos"
              >
                {hasScrolledToBottom ? (
                  "I Have Read and Accept the Terms of Service"
                ) : (
                  "Scroll to bottom to accept"
                )}
              </Button>
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-decline-tos">
                  Decline & Return to {APP_NAME}
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
