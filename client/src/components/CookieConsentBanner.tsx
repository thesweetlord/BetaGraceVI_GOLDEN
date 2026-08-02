import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Cookie, Settings, Shield, BarChart3, Wrench, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { generateUUID } from "@/lib/uuid";
import type { Consent } from "@shared/schema";
import { APP_NAME } from "@/lib/constants";

export function CookieConsentBanner() {
  const { showCookieConsent, setConsent, ageVerified, isOver18, sessionId } = useAppStore();
  const [showCustomize, setShowCustomize] = useState(false);
  const [preferences, setPreferences] = useState({
    essentialCookies: true,
    analyticsCookies: false,
    functionalCookies: true,
    dataRetention: true,
    marketingCommunications: false,
    thirdPartySharing: false,
  });

  if (!showCookieConsent || !ageVerified || isOver18 === false) return null;

  const handleAcceptAll = () => {
    const consent: Consent = {
      id: generateUUID(),
      sessionId: sessionId || '',
      essentialCookies: true,
      analyticsCookies: true,
      functionalCookies: true,
      dataRetention: true,
      marketingCommunications: true,
      thirdPartySharing: false,
      consentDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    setConsent(consent);
  };

  const handleRejectAll = () => {
    const consent: Consent = {
      id: generateUUID(),
      sessionId: sessionId || '',
      essentialCookies: true, // Essential always required
      analyticsCookies: false,
      functionalCookies: false,
      dataRetention: false,
      marketingCommunications: false,
      thirdPartySharing: false,
      consentDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    setConsent(consent);
  };

  const handleSavePreferences = () => {
    const consent: Consent = {
      id: generateUUID(),
      sessionId: sessionId || '',
      ...preferences,
      consentDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    setConsent(consent);
    setShowCustomize(false);
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <Card className="max-w-4xl mx-auto shadow-lg border-border/50">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex gap-3 items-start flex-1">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Cookie className="w-5 h-5 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    We value your privacy
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {APP_NAME} uses cookies and similar technologies to enhance your experience. 
                    Some are essential, while others help us improve our service.
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 sm:flex-nowrap w-full sm:w-auto">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setShowCustomize(true)}
                  className="flex-1 sm:flex-none"
                  data-testid="button-customize-cookies"
                >
                  <Settings className="w-4 h-4 mr-1" />
                  Customize
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleRejectAll}
                  className="flex-1 sm:flex-none"
                  data-testid="button-reject-cookies"
                >
                  Reject All
                </Button>
                <Button 
                  size="sm"
                  onClick={handleAcceptAll}
                  className="flex-1 sm:flex-none"
                  data-testid="button-accept-cookies"
                >
                  Accept All
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCustomize} onOpenChange={setShowCustomize}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Cookie Preferences
            </DialogTitle>
            <DialogDescription>
              Manage your cookie and data preferences. Essential cookies cannot be disabled as they are necessary for the site to function.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Card className="bg-muted/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-primary" />
                    <div>
                      <Label className="font-medium">Essential Cookies</Label>
                      <p className="text-xs text-muted-foreground">Required for basic site functionality</p>
                    </div>
                  </div>
                  <Switch checked disabled data-testid="switch-essential-cookies" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <Label className="font-medium">Analytics Cookies</Label>
                      <p className="text-xs text-muted-foreground">Help us improve by tracking usage patterns</p>
                    </div>
                  </div>
                  <Switch 
                    checked={preferences.analyticsCookies}
                    onCheckedChange={(checked) => setPreferences(p => ({ ...p, analyticsCookies: checked }))}
                    data-testid="switch-analytics-cookies"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Wrench className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <Label className="font-medium">Functional Cookies</Label>
                      <p className="text-xs text-muted-foreground">Remember your preferences and settings</p>
                    </div>
                  </div>
                  <Switch 
                    checked={preferences.functionalCookies}
                    onCheckedChange={(checked) => setPreferences(p => ({ ...p, functionalCookies: checked }))}
                    data-testid="switch-functional-cookies"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Cookie className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <Label className="font-medium">Data Retention</Label>
                      <p className="text-xs text-muted-foreground">Allow storage of conversation history</p>
                    </div>
                  </div>
                  <Switch 
                    checked={preferences.dataRetention}
                    onCheckedChange={(checked) => setPreferences(p => ({ ...p, dataRetention: checked }))}
                    data-testid="switch-data-retention"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <Label className="font-medium">Information Sharing</Label>
                      <p className="text-xs text-muted-foreground">Allow sharing with service providers and analytics</p>
                    </div>
                  </div>
                  <Switch 
                    checked={preferences.thirdPartySharing}
                    onCheckedChange={(checked) => setPreferences(p => ({ ...p, thirdPartySharing: checked }))}
                    data-testid="switch-information-sharing"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowCustomize(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSavePreferences} data-testid="button-save-preferences">
              Save Preferences
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
