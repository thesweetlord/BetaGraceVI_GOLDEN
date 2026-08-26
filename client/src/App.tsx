/*
 * BetaGrace — a multistack AI Agent, a sophisticated API wrapper with 8 modes.
 * Copyright (C) 2026  Jesse James Wheeler Jr.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/store";
import { useEffect } from "react";

import Dashboard from "@/pages/Dashboard";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import TermsOfService from "@/pages/TermsOfService";
import Settings from "@/pages/Settings";
import AdminConsentAudit from "@/pages/AdminConsentAudit";
import NotFound from "@/pages/not-found";

import { AgeVerificationModal } from "@/components/AgeVerificationModal";
import { UnderageNotice } from "@/components/UnderageNotice";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";

const PUBLIC_ROUTES = ["/privacy-policy", "/privacy", "/terms-of-service", "/terms", "/admin/consent-audit"];

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms-of-service" component={TermsOfService} />
      <Route path="/terms" component={TermsOfService} />
      <Route path="/settings" component={Settings} />
      <Route path="/admin/consent-audit" component={AdminConsentAudit} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const {
    ageVerified,
    isOver18,
    theme,
    sessionId,
    setSessionId,
    setSession,
    setAgeVerification,
    setConsent,
    setMessages,
    setCurrentConversationId,
    dataRetentionOptOut,
    setTheme,
  } = useAppStore();
  const [location] = useLocation();
  const isPublicRoute = PUBLIC_ROUTES.some(r => location === r || location.startsWith(r + "?"));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    let unsubscribe: (() => void) | undefined;
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      };
      mediaQuery.addEventListener('change', handler);
      // Proper cleanup
      unsubscribe = () => mediaQuery.removeEventListener('change', handler);
    }
    return unsubscribe;
  }, [theme]);

  // Temporal Theme Engine removed — it was overriding user-selected dark/light mode
  // every 60 seconds. Theme is now purely user-controlled via ThemeToggle.

  useEffect(() => {
    if (!sessionId && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('betagrace-storage');
        const parsed = stored ? JSON.parse(stored) : null;
        const persistedSessionId = parsed?.state?.sessionId;
        if (persistedSessionId) {
          setSessionId(persistedSessionId);
          return;
        }
      } catch {
        // Ignore malformed persisted state
      }

      const legacySessionId = localStorage.getItem('betagrace-sessionId');
      if (legacySessionId) {
        setSessionId(legacySessionId);
      }
    }
  }, [sessionId, setSessionId]);
  // CRITICAL: On app load, if sessionId exists but ageVerified is true, verify backend session still exists
  // This handles app restarts where backend in-memory storage was cleared
  useEffect(() => {
    if (ageVerified && sessionId) {
      // Silently verify backend session exists and has age verification
      fetch('/api/session', {
        method: 'POST',
        headers: {
          'x-session-id': sessionId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
        .then(res => res.json())
        .then(data => {
          setSession(data?.session ?? null);

          // The server is authoritative after deletion. Clear persisted client
          // data and reopen the legal flow when active consent was revoked.
          if (data?.session?.consentGiven !== true) {
            setMessages([]);
            setCurrentConversationId(null);
            setConsent(null);
            setAgeVerification(false, null);
            return;
          }

          // Re-verify if isOver18 is missing OR if learning data acknowledgment was never stamped
          // (handles sessions created before the learningDataAcknowledged column was added)
          if (data?.session?.isOver18 !== true || data?.session?.learningDataAcknowledged !== true) {
            return fetch('/api/session/verify-age', {
              method: 'POST',
              headers: {
                'x-session-id': sessionId,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ isOver18: true, learningDataAcknowledged: true, dataRetentionOptOut }),
            });
          }
        })
        .catch(() => {
          // Network error or other failure - user will see 403 on chat attempt
          // which will trigger modal then
        });
    }
  }, [ageVerified, sessionId, setAgeVerification, setConsent, setCurrentConversationId, setMessages, setSession]);

  // Public legal pages are accessible without age verification
  if (isPublicRoute) {
    return <Router />;
  }

  // SECURITY: Enforce age verification for all other routes
  if (!ageVerified) {
    return <AgeVerificationModal />;
  }

  if (isOver18 === false) {
    return <UnderageNotice />;
  }

  return (
    <>
      <Router />
      <CookieConsentBanner />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
