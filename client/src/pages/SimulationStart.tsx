import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Play, Brain, Target, Users, Clock, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import type { Scenario } from "@shared/schema";

interface StartResponse {
  sessionId: string;
  isResume?: boolean;
  message?: string;
}

export default function SimulationStart() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [existingSessionId, setExistingSessionId] = useState<string | null>(null);

  const {
    data: scenario,
    isLoading: scenarioLoading,
    error: scenarioError,
  } = useQuery<Scenario>({
    queryKey: ["/api/scenarios", scenarioId],
    enabled: !!scenarioId && isAuthenticated,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast({
        title: "Por favor inicia sesión",
        description: "Necesitas iniciar sesión para comenzar una simulación.",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [authLoading, isAuthenticated, toast]);

  useEffect(() => {
    if (scenarioError && isUnauthorizedError(scenarioError as Error)) {
      toast({
        title: "Sesión Expirada",
        description: "Por favor inicia sesión nuevamente.",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [scenarioError, toast]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/simulations/start", {
        scenarioId,
      });
      return (await response.json()) as StartResponse;
    },
    onSuccess: (data) => {
      if (data.isResume) {
        // Show resume dialog
        setExistingSessionId(data.sessionId);
        setShowResumeDialog(true);
      } else {
        navigate(`/simulation/${data.sessionId}`);
      }
    },
    onError: (error) => {
      if (isUnauthorizedError(error as Error)) {
        toast({
          title: "Sesión Expirada",
          description: "Por favor inicia sesión nuevamente.",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "No se pudo iniciar la simulación. Por favor intenta de nuevo.",
        variant: "destructive",
      });
    },
  });

  // Abandon current session and start fresh
  const abandonAndRestartMutation = useMutation({
    mutationFn: async () => {
      // First abandon the existing session
      if (existingSessionId) {
        await apiRequest("POST", `/api/simulations/${existingSessionId}/abandon`);
      }
      // Then create a new session
      const response = await apiRequest("POST", "/api/simulations/start", {
        scenarioId,
      });
      return (await response.json()) as StartResponse;
    },
    onSuccess: (data) => {
      setShowResumeDialog(false);
      navigate(`/simulation/${data.sessionId}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo reiniciar la simulación.",
        variant: "destructive",
      });
    },
  });

  const handleResumeSession = () => {
    setShowResumeDialog(false);
    if (existingSessionId) {
      navigate(`/simulation/${existingSessionId}`);
    }
  };

  const handleStartFresh = () => {
    abandonAndRestartMutation.mutate();
  };

  if (authLoading || scenarioLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Cargando escenario...</p>
        </div>
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Escenario No Encontrado</h2>
          <p className="text-muted-foreground mb-6">
            Este escenario puede haber sido eliminado o no está disponible.
          </p>
          <Button onClick={() => navigate("/")}>Volver al Inicio</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">
              {scenario.domain}
            </Badge>
            <h1 className="text-4xl font-bold mb-4" data-testid="text-scenario-title">
              {scenario.title}
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {scenario.description}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-chart-1/10 text-chart-1 flex items-center justify-center">
                  <Target className="w-5 h-5" />
                </div>
                <h3 className="font-semibold">Tu Rol</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {scenario.initialState?.role || "Líder de Negocios"}
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-chart-2/10 text-chart-2 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="font-semibold">Objetivo</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {scenario.initialState?.objective ||
                  "Navega el desafío empresarial y mantén los indicadores clave de desempeño."}
              </p>
            </Card>
          </div>

          <Card className="p-6 mb-12">
            <h3 className="font-semibold mb-4">Condiciones Iniciales</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: "Moral del Equipo", value: `${scenario.initialState?.kpis?.morale || 75}%` },
                { label: "Impacto Presupuestario", value: `${scenario.initialState?.kpis?.reputation || 75}%` },
                { label: "Riesgo Operacional", value: `${scenario.initialState?.kpis?.efficiency || 75}%` },
                { label: "Alineación Estratégica", value: `${scenario.initialState?.kpis?.trust || 75}%` },
                { label: "Presión de Tiempo", value: `${scenario.initialState?.kpis?.revenue ? Math.round(scenario.initialState.kpis.revenue / 10000) : 50}%` },
              ].map((kpi) => (
                <div key={kpi.label} className="text-center p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {kpi.label}
                  </p>
                  <p className="text-lg font-mono font-semibold">{kpi.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="text-center">
            <Button
              size="lg"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="button-start-simulation"
            >
              {startMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 mr-2" />
                  Comenzar Simulación
                </>
              )}
            </Button>
            <p className="text-sm text-muted-foreground mt-4">
              Tus decisiones afectarán el resultado. Piensa cuidadosamente.
            </p>
          </div>
        </motion.div>
      </main>

      <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-primary" />
              Sesión en progreso encontrada
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              Ya tienes una simulación en curso para este escenario. 
              <br /><br />
              <strong>Continuar:</strong> Retoma donde lo dejaste con todo tu progreso guardado.
              <br /><br />
              <strong>Empezar de nuevo:</strong> Tu sesión anterior se marcará como abandonada y comenzarás desde cero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel 
              onClick={() => setShowResumeDialog(false)}
              data-testid="button-cancel-resume"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStartFresh}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={abandonAndRestartMutation.isPending}
              data-testid="button-start-fresh"
            >
              {abandonAndRestartMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Reiniciando...
                </>
              ) : (
                "Empezar de nuevo"
              )}
            </AlertDialogAction>
            <Button
              onClick={handleResumeSession}
              data-testid="button-resume-session"
            >
              <Play className="w-4 h-4 mr-2" />
              Continuar sesión
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
