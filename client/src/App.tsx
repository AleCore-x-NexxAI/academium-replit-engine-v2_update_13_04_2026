import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { LanguageProvider, useTranslation } from "@/contexts/LanguageContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Brain, Loader2, AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import Landing from "@/pages/Landing";
import RoleSelection from "@/pages/RoleSelection";
import Home from "@/pages/Home";
import ExploreExample from "@/pages/ExploreExample";
import DemoSimulation from "@/pages/DemoSimulation";
import Simulation from "@/pages/Simulation";
import SimulationStart from "@/pages/SimulationStart";
import SessionResults from "@/pages/SessionResults";
import Studio from "@/pages/Studio";
import Analytics from "@/pages/Analytics";
import ProfessorDashboard from "@/pages/ProfessorDashboard";
import ScenarioEdit from "@/pages/ScenarioEdit";
import ScenarioAnalytics from "@/pages/ScenarioAnalytics";
import SimulationManagement from "@/pages/SimulationManagement";
import Settings from "@/pages/Settings";
import AiCostDashboard from "@/pages/AiCostDashboard";
import NotFound from "@/pages/not-found";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RoleProtectedRoute } from "@/components/RoleProtectedRoute";
import type { User } from "@shared/schema";

function AuthLoadingScreen() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center" data-testid="screen-auth-loading">
      <div className="text-center">
        <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center mx-auto mb-4">
          <Brain className="w-6 h-6 text-primary-foreground" />
        </div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("auth.loadingTitle")}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t("auth.loadingDesc")}</p>
      </div>
    </div>
  );
}

function AuthErrorScreen({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6" data-testid="screen-auth-error">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-14 h-14 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-bold mb-2">{t("auth.connectionError")}</h1>
        <p className="text-sm text-muted-foreground mb-6">{t("auth.connectionErrorDesc")}</p>
        <div className="flex flex-col gap-3">
          <Button onClick={onRetry} data-testid="button-auth-retry">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("common.tryAgain")}
          </Button>
          <Button variant="outline" onClick={() => window.location.href = "/"} data-testid="button-auth-home">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("auth.loginGoBack")}
          </Button>
        </div>
        {error && (
          <details className="mt-6 text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer">
              {t("common.error")}
            </summary>
            <pre className="mt-2 text-xs text-muted-foreground bg-muted p-3 rounded-md overflow-auto max-h-24">
              {error.message}
            </pre>
          </details>
        )}
      </Card>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  return (
    <>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/explore" component={ExploreExample} />
        <Route path="/demo-simulation">
          <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
            <DemoSimulation />
          </RoleProtectedRoute>
        </Route>
        <Route path="/simulation/start/:scenarioId" component={SimulationStart} />
        <Route path="/simulation/:sessionId/results" component={SessionResults} />
        <Route path="/simulation/:sessionId" component={Simulation} />
        <Route path="/studio">
          <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
            <Studio />
          </RoleProtectedRoute>
        </Route>
        <Route path="/analytics">
          <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
            <Analytics />
          </RoleProtectedRoute>
        </Route>
        <Route path="/professor">
          <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
            <ProfessorDashboard />
          </RoleProtectedRoute>
        </Route>
        <Route path="/scenarios/:scenarioId/manage">
          <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
            <SimulationManagement />
          </RoleProtectedRoute>
        </Route>
        <Route path="/scenarios/:scenarioId/edit">
          {(params) => (
            <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
              <ScenarioEdit />
            </RoleProtectedRoute>
          )}
        </Route>
        <Route path="/scenarios/:scenarioId/analytics">
          {(params) => (
            <RoleProtectedRoute allowedRoles={["professor", "admin"]}>
              <ScenarioAnalytics />
            </RoleProtectedRoute>
          )}
        </Route>
        <Route path="/settings">
          <RoleProtectedRoute allowedRoles={["admin"]}>
            <Settings />
          </RoleProtectedRoute>
        </Route>
        <Route path="/admin/ai-costs">
          <RoleProtectedRoute allowedRoles={["admin"]}>
            <AiCostDashboard />
          </RoleProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
      {user && <OnboardingModal user={user} />}
    </>
  );
}

function Router() {
  const { isAuthenticated, isLoading, error } = useAuth();
  const [showTimeout, setShowTimeout] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (isLoading) {
      setShowTimeout(false);
      const timer = setTimeout(() => setShowTimeout(true), 8000);
      return () => clearTimeout(timer);
    }
    setShowTimeout(false);
  }, [isLoading, retryCount]);

  if (isLoading && !showTimeout) {
    return <AuthLoadingScreen />;
  }

  if (isLoading && showTimeout) {
    return (
      <AuthErrorScreen
        error={new Error("Request timed out")}
        onRetry={() => {
          setRetryCount((c) => c + 1);
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        }}
      />
    );
  }

  if (error && !isAuthenticated) {
    return (
      <AuthErrorScreen
        error={error}
        onRetry={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] })}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/select-role" component={RoleSelection} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <TooltipProvider delayDuration={200} skipDelayDuration={0}>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
