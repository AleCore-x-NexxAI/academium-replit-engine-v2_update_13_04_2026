import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Save,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { HelpIcon } from "@/components/HelpIcon";

interface ManualCaseCreatorProps {
  onSuccess: () => void;
  onClose: () => void;
}

interface DecisionPointData {
  prompt: string;
  format: "multiple_choice" | "short_response";
  options?: string[]; // For multiple choice
}

interface IndicatorData {
  enabled: boolean;
  label: string;
  initialValue: number;
}

interface FormData {
  title: string;
  caseContext: string;
  decisions: DecisionPointData[];
  consequenceNarrative: string;
  indicators: {
    morale: IndicatorData;
    budget: IndicatorData;
  };
  ethicsNote: string;
  instructorNotes: string;
}

export default function ManualCaseCreator({
  onSuccess,
  onClose,
}: ManualCaseCreatorProps) {
  const { toast } = useToast();
  const [optionalOpen, setOptionalOpen] = useState(false);
  
  const [formData, setFormData] = useState<FormData>({
    title: "",
    caseContext: "",
    decisions: [
      { prompt: "", format: "multiple_choice", options: ["", "", ""] },
      { prompt: "", format: "short_response" },
      { prompt: "", format: "short_response" },
    ],
    consequenceNarrative: "",
    indicators: {
      morale: { enabled: false, label: "Moral del Equipo", initialValue: 75 },
      budget: { enabled: false, label: "Presupuesto", initialValue: 100000 },
    },
    ethicsNote: "",
    instructorNotes: "",
  });

  const updateDecision = (index: number, field: keyof DecisionPointData, value: string | string[]) => {
    setFormData(prev => {
      const newDecisions = [...prev.decisions];
      newDecisions[index] = { ...newDecisions[index], [field]: value };
      return { ...prev, decisions: newDecisions };
    });
  };

  const updateMultipleChoiceOption = (decisionIndex: number, optionIndex: number, value: string) => {
    setFormData(prev => {
      const newDecisions = [...prev.decisions];
      const options = [...(newDecisions[decisionIndex].options || ["", "", ""])];
      options[optionIndex] = value;
      newDecisions[decisionIndex] = { ...newDecisions[decisionIndex], options };
      return { ...prev, decisions: newDecisions };
    });
  };

  const toggleIndicator = (key: "morale" | "budget") => {
    setFormData(prev => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [key]: { ...prev.indicators[key], enabled: !prev.indicators[key].enabled },
      },
    }));
  };

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scenarios", {
        title: formData.title || "Borrador sin título",
        description: formData.caseContext.slice(0, 200) || "Caso en desarrollo",
        domain: "Negocios",
        initialState: {
          role: "Gerente",
          objective: "Tomar decisiones estratégicas",
          introText: formData.caseContext,
          kpis: {
            revenue: formData.indicators.budget.enabled ? formData.indicators.budget.initialValue : 100000,
            morale: formData.indicators.morale.enabled ? formData.indicators.morale.initialValue : 75,
            reputation: 75,
            efficiency: 75,
            trust: 75,
          },
        },
        decisionPoints: formData.decisions.map((d, i) => ({
          id: `decision-${i + 1}`,
          prompt: d.prompt,
          format: d.format,
          options: d.options?.filter(o => o.trim()),
        })),
        consequenceNarrative: formData.consequenceNarrative,
        ethicsNote: formData.ethicsNote || undefined,
        instructorNotes: formData.instructorNotes || undefined,
        isPublished: false,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Borrador guardado", description: "Tu caso ha sido guardado como borrador." });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/authored"] });
      onSuccess();
    },
    onError: (error) => {
      if (isUnauthorizedError(error as Error)) {
        toast({ title: "Sesión expirada", description: "Por favor inicia sesión de nuevo.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "No se pudo guardar el borrador.", variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/scenarios", {
        title: formData.title,
        description: formData.caseContext.slice(0, 200),
        domain: "Negocios",
        initialState: {
          role: "Gerente",
          objective: "Tomar decisiones estratégicas",
          introText: formData.caseContext,
          kpis: {
            revenue: formData.indicators.budget.enabled ? formData.indicators.budget.initialValue : 100000,
            morale: formData.indicators.morale.enabled ? formData.indicators.morale.initialValue : 75,
            reputation: 75,
            efficiency: 75,
            trust: 75,
          },
        },
        decisionPoints: formData.decisions.map((d, i) => ({
          id: `decision-${i + 1}`,
          prompt: d.prompt,
          format: d.format,
          options: d.options?.filter(o => o.trim()),
        })),
        consequenceNarrative: formData.consequenceNarrative,
        ethicsNote: formData.ethicsNote || undefined,
        instructorNotes: formData.instructorNotes || undefined,
        isPublished: true,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Caso publicado", description: "Tu simulación está lista para estudiantes." });
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios/authored"] });
      onSuccess();
    },
    onError: (error) => {
      if (isUnauthorizedError(error as Error)) {
        toast({ title: "Sesión expirada", description: "Por favor inicia sesión de nuevo.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "No se pudo publicar el caso.", variant: "destructive" });
    },
  });

  const isFormValid = () => {
    return (
      formData.title.trim().length >= 3 &&
      formData.caseContext.trim().length >= 20 &&
      formData.decisions[0].prompt.trim().length >= 10 &&
      formData.decisions[1].prompt.trim().length >= 10 &&
      formData.decisions[2].prompt.trim().length >= 10
    );
  };

  return (
    <Card className="h-full flex flex-col overflow-hidden" data-testid="manual-case-creator">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <h2 className="font-semibold">Crear Caso Manualmente</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-manual-creator"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Scrollable Form Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Case Title */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="title">Título del Caso</Label>
            <HelpIcon content="Un nombre corto y descriptivo que los estudiantes verán al iniciar la simulación." />
          </div>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Ej: Crisis de Lanzamiento de Producto"
            data-testid="input-case-title"
          />
        </div>

        {/* Section 1: Case Context */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Contexto del Caso</h3>
            <HelpIcon content="Establece la situación empresarial. Incluye la empresa, el mercado, y el desafío que enfrentan los estudiantes." />
            <Badge variant="secondary" className="text-xs">Requerido</Badge>
          </div>
          <Textarea
            value={formData.caseContext}
            onChange={(e) => setFormData(prev => ({ ...prev, caseContext: e.target.value }))}
            placeholder="Describe el contexto empresarial, la empresa, el mercado y la situación que enfrentan los estudiantes..."
            className="min-h-[120px]"
            data-testid="input-case-context"
          />
        </div>

        {/* Section 2: Decision Points */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Puntos de Decisión</h3>
            <HelpIcon content="Los estudiantes tomarán 3 decisiones durante la simulación. La primera es de opción múltiple; las siguientes son respuestas escritas." />
            <Badge variant="secondary" className="text-xs">3 decisiones</Badge>
          </div>

          {formData.decisions.map((decision, index) => (
            <Card key={index} className="p-4 space-y-3" data-testid={`decision-card-${index + 1}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">Decisión {index + 1}</span>
                <Badge variant="outline">
                  {decision.format === "multiple_choice" ? "Opción múltiple" : "Respuesta escrita"}
                </Badge>
              </div>
              
              <div className="space-y-2">
                <Label>Pregunta o situación</Label>
                <Textarea
                  value={decision.prompt}
                  onChange={(e) => updateDecision(index, "prompt", e.target.value)}
                  placeholder={
                    index === 0 
                      ? "¿Qué estrategia inicial adoptarías para el lanzamiento?" 
                      : index === 1
                        ? "Ante la reacción del mercado, ¿cómo ajustarías tu enfoque?"
                        : "¿Qué decisión final tomarías para resolver la crisis?"
                  }
                  className="min-h-[80px]"
                  data-testid={`input-decision-prompt-${index + 1}`}
                />
              </div>

              {/* Multiple choice options for Decision 1 */}
              {decision.format === "multiple_choice" && (
                <div className="space-y-2">
                  <Label>Opciones de respuesta</Label>
                  {(decision.options || ["", "", ""]).map((option, optIndex) => (
                    <Input
                      key={optIndex}
                      value={option}
                      onChange={(e) => updateMultipleChoiceOption(index, optIndex, e.target.value)}
                      placeholder={`Opción ${String.fromCharCode(65 + optIndex)}`}
                      data-testid={`input-option-${index + 1}-${optIndex + 1}`}
                    />
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Section 3: Consequences */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Consecuencias</h3>
            <HelpIcon content="Describe el impacto general de las decisiones. Los indicadores son opcionales y muestran métricas simples." />
          </div>
          
          <div className="space-y-2">
            <Label>Narrativa de consecuencias</Label>
            <Textarea
              value={formData.consequenceNarrative}
              onChange={(e) => setFormData(prev => ({ ...prev, consequenceNarrative: e.target.value }))}
              placeholder="Las decisiones del estudiante impactarán en..."
              className="min-h-[80px]"
              data-testid="input-consequence-narrative"
            />
          </div>

          {/* Simple Indicators */}
          <div className="space-y-3">
            <div className="flex items-center gap-1">
              <Label>Indicadores simples (opcional)</Label>
              <HelpIcon content="Activa indicadores para mostrar cambios visuales en métricas como moral o presupuesto." />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.indicators.morale.enabled}
                  onCheckedChange={() => toggleIndicator("morale")}
                  data-testid="switch-indicator-morale"
                />
                <span className="text-sm">Moral del equipo</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.indicators.budget.enabled}
                  onCheckedChange={() => toggleIndicator("budget")}
                  data-testid="switch-indicator-budget"
                />
                <span className="text-sm">Presupuesto</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Optional (Collapsed) */}
        <Collapsible open={optionalOpen} onOpenChange={setOptionalOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between"
              data-testid="button-toggle-optional"
            >
              <span className="font-semibold">Opcional</span>
              {optionalOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="ethics">Nota de ética</Label>
              <Textarea
                id="ethics"
                value={formData.ethicsNote}
                onChange={(e) => setFormData(prev => ({ ...prev, ethicsNote: e.target.value }))}
                placeholder="Consideraciones éticas que los estudiantes deben tener en cuenta..."
                className="min-h-[80px]"
                data-testid="input-ethics-note"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instructor">Notas del instructor (privadas)</Label>
              <Textarea
                id="instructor"
                value={formData.instructorNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorNotes: e.target.value }))}
                placeholder="Notas privadas para otros instructores o para ti mismo..."
                className="min-h-[80px]"
                data-testid="input-instructor-notes"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-3 p-4 border-t bg-muted/30">
        <Button
          variant="outline"
          onClick={() => saveDraftMutation.mutate()}
          disabled={saveDraftMutation.isPending || publishMutation.isPending}
          data-testid="button-save-draft"
        >
          {saveDraftMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Guardar Borrador
            </>
          )}
        </Button>
        <Button
          onClick={() => publishMutation.mutate()}
          disabled={!isFormValid() || saveDraftMutation.isPending || publishMutation.isPending}
          data-testid="button-publish-case"
        >
          {publishMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Publicando...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Publicar
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
