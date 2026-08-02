import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { APP_NAME } from "@/lib/constants";

export default function PrivacyPolicy() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrivacyPolicy = async () => {
      try {
        const response = await fetch("/api/privacy-policy");
        if (!response.ok) {
          throw new Error("Failed to load privacy policy");
        }
        const markdown = await response.text();
        setContent(markdown);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load privacy policy");
      } finally {
        setLoading(false);
      }
    };

    fetchPrivacyPolicy();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading privacy policy...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <Shield className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Error Loading Privacy Policy</h2>
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
    <div className="min-h-screen bg-background">
      {/* Header */}
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

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold" data-testid="text-privacy-title">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Your privacy is important to us. This policy explains how {APP_NAME} collects,
            uses, and protects your information.
          </p>
        </div>

        {/* Content */}
        <ScrollArea className="max-w-none">
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}