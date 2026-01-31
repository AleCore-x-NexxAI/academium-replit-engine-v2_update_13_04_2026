import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  BookOpen,
  ArrowLeft,
  Target,
  Building2,
  User,
  MessageSquare,
  Clock,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const EXAMPLE_CASE = {
  title: "Crisis de Lanzamiento de Producto",
  domain: "Gestión de Crisis",
  duration: "20-25 minutos",
  role: "Gerente de Producto",
  company: "TechSolutions",
  industry: "Tecnología/Software B2B",
  context: `Eres el Gerente de Producto de TechSolutions, una empresa de software B2B. A tres días del lanzamiento de tu producto estrella 'CloudSync Pro', el equipo de QA descubre un problema crítico de seguridad que podría exponer datos de clientes. El CEO espera tu recomendación antes del fin del día.

TechSolutions ha invertido 18 meses y $2M en desarrollar CloudSync Pro. El equipo de ventas ya cerró pre-ventas por $500K. La competencia planea lanzar un producto similar en 6 semanas.`,
  coreChallenge: "Gestionar la crisis del lanzamiento equilibrando intereses de stakeholders, riesgos operacionales y reputación de la empresa.",
  constraints: [
    "Lanzamiento programado en 3 días",
    "Pre-ventas comprometidas por $500K",
    "Competencia lanza en 6 semanas",
    "Vulnerabilidad de seguridad confirmada",
  ],
  decisionPoints: [
    {
      id: 1,
      type: "multiple_choice",
      title: "Decisión 1: Acción Inmediata",
      description: "Elige tu primera respuesta ante la crisis",
      preview: "4 opciones: Informar al CEO, trabajo 24/7, lanzar con parche, o consultar legal",
    },
    {
      id: 2,
      type: "written",
      title: "Decisión 2: Gestión de Stakeholders",
      description: "Explica cómo manejas la tensión entre ventas y QA",
      preview: "Respuesta escrita: Cómo equilibras las demandas de diferentes grupos",
    },
    {
      id: 3,
      type: "reflection",
      title: "Decisión 3: Reflexión Final",
      description: "Sintetiza tu aprendizaje",
      preview: "Reflexión integradora: ¿Qué aprendiste? ¿Qué harías diferente?",
    },
  ],
  indicators: [
    { id: "revenue", label: "Ingresos / Presupuesto", description: "Salud financiera y disponibilidad de recursos" },
    { id: "morale", label: "Moral del Equipo", description: "Estado emocional y compromiso del equipo" },
    { id: "reputation", label: "Reputación de Marca", description: "Percepción pública y credibilidad de marca" },
    { id: "efficiency", label: "Eficiencia Operacional", description: "Optimización de procesos y recursos" },
    { id: "trust", label: "Confianza de Stakeholders", description: "Nivel de confianza de partes interesadas" },
  ],
};

export default function ExploreExample() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-[1000]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <span className="font-semibold" data-testid="text-preview-title">Simulación de Ejemplo</span>
          </div>
          <Badge variant="secondary" data-testid="badge-readonly">
            Solo lectura
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >

          <Card className="mb-8">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl mb-2" data-testid="text-example-title">
                    {EXAMPLE_CASE.title}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{EXAMPLE_CASE.domain}</Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {EXAMPLE_CASE.duration}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <User className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Tu Rol</p>
                    <p className="text-sm text-muted-foreground">{EXAMPLE_CASE.role}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <Building2 className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Organización</p>
                    <p className="text-sm text-muted-foreground">{EXAMPLE_CASE.company} • {EXAMPLE_CASE.industry}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  Contexto del Caso
                </h3>
                <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                  {EXAMPLE_CASE.context}
                </div>
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Desafío Central
                </h3>
                <p className="text-sm">{EXAMPLE_CASE.coreChallenge}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Puntos de Decisión
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {EXAMPLE_CASE.decisionPoints.map((decision, index) => (
                <div
                  key={decision.id}
                  className="flex items-start gap-4 p-4 rounded-lg border"
                  data-testid={`card-decision-preview-${decision.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold text-sm">
                    {decision.id}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium" data-testid={`text-decision-title-${decision.id}`}>{decision.title}</h4>
                      <Badge variant="outline" className="text-xs" data-testid={`badge-decision-type-${decision.id}`}>
                        {decision.type === "multiple_choice" ? "Opción múltiple" : 
                         decision.type === "written" ? "Respuesta escrita" : "Reflexión"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2" data-testid={`text-decision-description-${decision.id}`}>{decision.description}</p>
                    <p className="text-xs text-muted-foreground/70 italic" data-testid={`text-decision-preview-${decision.id}`}>{decision.preview}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg">Indicadores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_CASE.indicators.map((indicator) => (
                  <Badge key={indicator.id} variant="outline" data-testid={`badge-indicator-${indicator.id}`}>
                    {indicator.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center gap-4">
            <Link href="/">
              <Button variant="outline" data-testid="button-back-to-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Volver al Inicio
              </Button>
            </Link>
            <Button onClick={() => navigate("/demo-simulation")} data-testid="button-start-demo">
              <Play className="w-4 h-4 mr-2" />
              Iniciar Demo
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
