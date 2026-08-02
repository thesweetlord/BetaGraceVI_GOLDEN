import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Heart, ExternalLink } from "lucide-react";
import { APP_NAME, COPPA_MIN_AGE, GITHUB_ISSUES_URL } from "@/lib/constants";
import { useAppStore } from "@/lib/store";

export function UnderageNotice() {
  const { isOver18, resetAllData } = useAppStore();

  if (isOver18 !== false) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/20 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Heart className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            Thank You for Visiting {APP_NAME}
          </CardTitle>
          <CardDescription className="text-base">
            We appreciate your interest in our creative writing assistant!
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-sm">Your Privacy is Protected</p>
                <p className="text-sm text-muted-foreground">
                  Under the Children's Online Privacy Protection Act (COPPA), we cannot collect personal information from users under {COPPA_MIN_AGE} without parental consent.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium text-sm">What This Means:</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>We will not store any of your information</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>You cannot use our AI writing features at this time</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>A parent or guardian can contact us to set up an account for you</span>
              </li>
            </ul>
          </div>

          <div className="pt-2 space-y-3">
            <Button 
              variant="outline" 
              className="w-full gap-2"
              onClick={() => window.open(GITHUB_ISSUES_URL, '_blank')}
              data-testid="button-contact-parent"
            >
              <ExternalLink className="w-4 h-4" />
              Request Parental Consent
            </Button>
            
            <Button 
              variant="ghost" 
              className="w-full text-muted-foreground"
              onClick={resetAllData}
              data-testid="button-reset-verification"
            >
              I entered my age incorrectly
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            We comply with all U.S. federal laws including COPPA.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
