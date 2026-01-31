import { useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  BookOpen, 
  Target,
  Building2,
  User,
  MessageSquare,
  Send,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

const DEMO_SCENARIO = {
  title: "Crisis de Lanzamiento de Producto",
  domain: "Gestión de Crisis",
  role: "Gerente de Producto",
  company: "TechSolutions",
  industry: "Tecnología/Software B2B",
  context: `Eres el Gerente de Producto de TechSolutions, una empresa de software B2B. A tres días del lanzamiento de tu producto estrella 'CloudSync Pro', el equipo de QA descubre un problema crítico de seguridad que podría exponer datos de clientes. El CEO espera tu recomendación antes del fin del día.

TechSolutions ha invertido 18 meses y $2M en desarrollar CloudSync Pro. El equipo de ventas ya cerró pre-ventas por $500K. La competencia planea lanzar un producto similar en 6 semanas.`,
  coreChallenge: "Gestionar la crisis del lanzamiento equilibrando intereses de stakeholders, riesgos operacionales y reputación de la empresa.",
  objective: "Tomar decisiones estratégicas para manejar la crisis y proteger los intereses de la empresa",
};

const DEMO_DECISIONS = [
  {
    id: 1,
    title: "Decisión 1: Acción Inmediata",
    prompt: "El equipo de QA te ha informado sobre la vulnerabilidad crítica. ¿Cuál es tu primera acción?",
    format: "multiple_choice" as const,
    options: [
      { id: "A", text: "Informar inmediatamente al CEO y solicitar una reunión de emergencia" },
      { id: "B", text: "Pedir al equipo de desarrollo que trabaje 24/7 para solucionar el problema" },
      { id: "C", text: "Proceder con el lanzamiento y planificar un parche posterior" },
      { id: "D", text: "Consultar con el equipo legal sobre posibles implicaciones" },
    ],
  },
  {
    id: 2,
    title: "Decisión 2: Gestión de Stakeholders",
    prompt: "El equipo de ventas está presionando para mantener la fecha de lanzamiento. ¿Cómo equilibras las demandas de ventas con las preocupaciones de seguridad?",
    format: "written" as const,
    placeholder: "Describe tu estrategia para manejar las expectativas del equipo de ventas mientras priorizas la seguridad...",
  },
  {
    id: 3,
    title: "Decisión 3: Reflexión Final",
    prompt: "Reflexiona sobre esta experiencia: ¿Qué aprendiste sobre la gestión de crisis? ¿Qué harías diferente la próxima vez?",
    format: "written" as const,
    placeholder: "Comparte tu reflexión sobre el proceso de toma de decisiones y los aprendizajes clave...",
  },
];

const STANDARD_INDICATORS = [
  { id: "revenue", label: "Ingresos / Presupuesto", value: 65, previousValue: 65 },
  { id: "morale", label: "Moral del Equipo", value: 70, previousValue: 70 },
  { id: "reputation", label: "Reputación de Marca", value: 75, previousValue: 75 },
  { id: "efficiency", label: "Eficiencia Operacional", value: 60, previousValue: 60 },
  { id: "trust", label: "Confianza de Stakeholders", value: 72, previousValue: 72 },
];

const DEMO_RESPONSES: Record<number, { narrative: string; feedback: string; indicatorChanges: Record<string, number> }> = {
  1: {
    narrative: `Tu decisión de actuar rápidamente ha sido notada por el equipo.

El CEO aprecia tu proactividad en comunicar el problema. En la reunión de emergencia, se discuten las opciones disponibles. El equipo legal confirma que lanzar con la vulnerabilidad podría resultar en demandas significativas.

Después de una discusión intensa, se decide aplazar el lanzamiento 2 semanas. El equipo de ventas no está contento, pero comprende la gravedad de la situación.`,
    feedback: "Tu decisión de informar al CEO inmediatamente demuestra buenas prácticas de gestión de crisis. La transparencia temprana permite tomar decisiones informadas.",
    indicatorChanges: { morale: -5, trust: 10, reputation: 5 },
  },
  2: {
    narrative: `Tu estrategia de comunicación con el equipo de ventas ha sido implementada.

Al presentar datos concretos sobre los riesgos legales y reputacionales, logras que el equipo de ventas comprenda la situación. Propones un plan de compensación para los clientes con pre-ventas: acceso anticipado a funciones premium sin costo adicional.

El equipo de ventas acepta comunicar el retraso a los clientes, posicionándolo como un compromiso con la calidad.`,
    feedback: "Tu enfoque equilibrado entre la presión comercial y la seguridad muestra madurez en la toma de decisiones. La propuesta de compensación es creativa.",
    indicatorChanges: { revenue: -10, efficiency: 5, trust: 8 },
  },
  3: {
    narrative: `Has completado la simulación de gestión de crisis.

El lanzamiento finalmente se realizó con éxito 2 semanas después. La vulnerabilidad fue corregida, y los clientes apreciaron la transparencia de TechSolutions. La compensación ofrecida generó buena voluntad en el mercado.

Este caso demuestra la importancia de priorizar la seguridad y mantener una comunicación clara con todos los stakeholders.`,
    feedback: "Tu reflexión muestra una comprensión profunda de los trade-offs en la gestión de crisis. Recuerda: las decisiones difíciles a menudo no tienen respuestas perfectas, solo mejores alternativas.",
    indicatorChanges: { revenue: 5, reputation: 10, morale: 8 },
  },
};

interface HistoryEntry {
  role: "system" | "user" | "npc";
  content: string;
  timestamp: Date;
}

export default function DemoSimulation() {
  const [, navigate] = useLocation();
  const [currentDecision, setCurrentDecision] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      role: "system",
      content: DEMO_SCENARIO.context,
      timestamp: new Date(),
    },
  ]);
  const [indicators, setIndicators] = useState(STANDARD_INDICATORS);
  const [selectedOption, setSelectedOption] = useState("");
  const [writtenResponse, setWrittenResponse] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const handleSubmitDecision = useCallback(async () => {
    if (currentDecision >= DEMO_DECISIONS.length) return;
    
    const decision = DEMO_DECISIONS[currentDecision];
    const userResponse = decision.format === "multiple_choice" 
      ? decision.options?.find(o => o.id === selectedOption)?.text || ""
      : writtenResponse;
    
    if (!userResponse.trim()) return;

    setIsProcessing(true);
    setCurrentFeedback(null);

    setHistory(prev => [...prev, {
      role: "user" as const,
      content: userResponse,
      timestamp: new Date(),
    }]);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const response = DEMO_RESPONSES[currentDecision + 1];
    
    setHistory(prev => [...prev, {
      role: "npc" as const,
      content: response.narrative,
      timestamp: new Date(),
    }]);

    setIndicators(prev => prev.map(ind => ({
      ...ind,
      previousValue: ind.value,
      value: ind.value + (response.indicatorChanges[ind.id] || 0),
    })));

    setCurrentFeedback(response.feedback);
    setIsProcessing(false);
    setSelectedOption("");
    setWrittenResponse("");

    if (currentDecision + 1 >= DEMO_DECISIONS.length) {
      setIsComplete(true);
    } else {
      setCurrentDecision(prev => prev + 1);
    }
  }, [currentDecision, selectedOption, writtenResponse]);

  const currentDecisionData = DEMO_DECISIONS[currentDecision];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-[1000]">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/explore">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <span className="font-semibold text-sm" data-testid="text-demo-title">
                {DEMO_SCENARIO.title}
              </span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Eye className="w-3 h-3" />
                Modo Demo (Solo Visualización)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Sin guardar datos
            </Badge>
            <Badge variant="secondary">
              Decisión {Math.min(currentDecision + 1, DEMO_DECISIONS.length)} de {DEMO_DECISIONS.length}
            </Badge>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        <aside className="w-72 border-r bg-muted/30 p-4 hidden lg:block">
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Rol
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-primary" />
                {DEMO_SCENARIO.role}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Organización
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="w-4 h-4 text-primary" />
                {DEMO_SCENARIO.company}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Objetivo
              </h3>
              <p className="text-sm text-muted-foreground">{DEMO_SCENARIO.objective}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Progreso
              </h3>
              <Progress 
                value={(currentDecision / DEMO_DECISIONS.length) * 100} 
                className="h-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isComplete ? "Completado" : `${currentDecision} de ${DEMO_DECISIONS.length} decisiones`}
              </p>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col lg:flex-row">
          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-2xl mx-auto space-y-4">
                <AnimatePresence mode="popLayout">
                  {history.map((entry, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`p-4 rounded-lg ${
                        entry.role === "user" 
                          ? "bg-primary/10 ml-8" 
                          : entry.role === "system"
                          ? "bg-muted border"
                          : "bg-card border mr-8"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {entry.role === "system" && (
                          <BookOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        )}
                        {entry.role === "npc" && (
                          <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground mb-1">
                            {entry.role === "user" ? "Tu decisión" : entry.role === "system" ? "Contexto" : "Resultado"}
                          </p>
                          <p className="text-sm whitespace-pre-line">{entry.content}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {isProcessing && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-lg bg-muted border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="animate-pulse flex gap-1">
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-sm text-muted-foreground">Procesando tu decisión...</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>

            {!isComplete && currentDecisionData && (
              <div className="border-t p-4 bg-background">
                <div className="max-w-2xl mx-auto space-y-4">
                  <div>
                    <h3 className="font-semibold mb-1">{currentDecisionData.title}</h3>
                    <p className="text-sm text-muted-foreground">{currentDecisionData.prompt}</p>
                  </div>

                  {currentDecisionData.format === "multiple_choice" && currentDecisionData.options && (
                    <RadioGroup value={selectedOption} onValueChange={setSelectedOption}>
                      {currentDecisionData.options.map((option) => (
                        <div
                          key={option.id}
                          className="flex items-start gap-3 p-3 rounded-lg border hover-elevate cursor-pointer"
                          onClick={() => setSelectedOption(option.id)}
                        >
                          <RadioGroupItem value={option.id} id={option.id} className="mt-0.5" />
                          <Label htmlFor={option.id} className="text-sm cursor-pointer flex-1">
                            <span className="font-medium">{option.id}.</span> {option.text}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}

                  {currentDecisionData.format === "written" && (
                    <Textarea
                      value={writtenResponse}
                      onChange={(e) => setWrittenResponse(e.target.value)}
                      placeholder={currentDecisionData.placeholder || "Escribe tu respuesta..."}
                      rows={4}
                      className="resize-none"
                      data-testid="input-written-response"
                    />
                  )}

                  <Button
                    onClick={handleSubmitDecision}
                    disabled={isProcessing || (currentDecisionData.format === "multiple_choice" ? !selectedOption : !writtenResponse.trim())}
                    className="w-full"
                    data-testid="button-submit-decision"
                  >
                    {isProcessing ? (
                      "Procesando..."
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Enviar Decisión
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {isComplete && (
              <div className="border-t p-4 bg-background">
                <div className="max-w-2xl mx-auto text-center">
                  <div className="p-6 rounded-lg bg-green-500/10 border border-green-500/30">
                    <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Demo Completado</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Has experimentado el flujo completo de simulación que verán tus estudiantes.
                    </p>
                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" onClick={() => navigate("/explore")}>
                        Volver al Ejemplo
                      </Button>
                      <Button onClick={() => navigate("/")}>
                        Ir al Inicio
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="w-80 border-l bg-muted/20 p-4 hidden xl:block">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
                  Indicadores
                </h3>
                <div className="space-y-3">
                  {indicators.map((indicator) => {
                    const change = indicator.value - indicator.previousValue;
                    return (
                      <div key={indicator.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{indicator.label}</span>
                          <div className="flex items-center gap-1">
                            <span className="font-medium">{indicator.value}%</span>
                            {change !== 0 && (
                              <span className={`text-xs flex items-center ${change > 0 ? "text-green-600" : "text-red-600"}`}>
                                {change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                {change > 0 ? "+" : ""}{change}
                              </span>
                            )}
                            {change === 0 && (
                              <Minus className="w-3 h-3 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                        <Progress 
                          value={indicator.value} 
                          className={`h-2 ${change > 0 ? "[&>div]:bg-green-500" : change < 0 ? "[&>div]:bg-red-500" : ""}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {currentFeedback && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                    Observaciones
                  </h3>
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="p-4">
                      <p className="text-sm">{currentFeedback}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
