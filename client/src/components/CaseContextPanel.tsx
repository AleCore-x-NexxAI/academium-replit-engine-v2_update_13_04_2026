import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Target,
  Building2,
  User,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageSquare,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Scenario, DecisionPoint } from "@shared/schema";

interface CaseContextPanelProps {
  scenario: Scenario;
  currentDecision: number;
  totalDecisions: number;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function CaseContextPanel({
  scenario,
  currentDecision,
  totalDecisions,
  isExpanded = true,
  onToggle,
}: CaseContextPanelProps) {
  const [showFullContext, setShowFullContext] = useState(true);
  const initialState = scenario.initialState;

  const caseContext = initialState?.caseContext || initialState?.introText || "";
  const coreChallenge = initialState?.coreChallenge || "";
  const reflectionPrompt = initialState?.reflectionPrompt || "";
  const role = initialState?.role || "Líder de Negocios";
  const objective = initialState?.objective || "";
  const companyName = initialState?.companyName || "";
  const industry = initialState?.industry || scenario.domain;
  const decisionPoints = initialState?.decisionPoints || [];

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <span className="font-semibold">Documento del Caso</span>
        </div>
        {onToggle && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            data-testid="button-toggle-case-panel"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <h2 className="text-lg font-bold mb-2" data-testid="text-case-title">
              {scenario.title}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{industry}</Badge>
              {companyName && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {companyName}
                </Badge>
              )}
            </div>
          </div>

          <Separator />

          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">Tu Rol</span>
            </div>
            <p className="text-sm">{role}</p>
          </Card>

          {objective && (
            <Card className="p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-primary" />
                <span className="font-medium text-sm">Objetivo</span>
              </div>
              <p className="text-sm">{objective}</p>
            </Card>
          )}

          <Separator />

          <div>
            <button
              type="button"
              onClick={() => setShowFullContext(!showFullContext)}
              className="w-full flex items-center justify-between py-2 hover-elevate rounded"
              data-testid="button-toggle-context"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" />
                <span className="font-medium">Contexto del Caso</span>
              </div>
              {showFullContext ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            <AnimatePresence>
              {showFullContext && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="pt-2 space-y-3">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {caseContext}
                    </p>

                    {coreChallenge && (
                      <Card className="p-3 bg-primary/5 border-primary/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Target className="w-4 h-4 text-primary" />
                          <span className="font-medium text-sm text-primary">
                            Desafío Central
                          </span>
                        </div>
                        <p className="text-sm">{coreChallenge}</p>
                      </Card>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {decisionPoints.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Estructura de Decisiones
                </h4>
                <div className="space-y-2">
                  {decisionPoints.map((dp: DecisionPoint, index: number) => {
                    const isCurrent = index + 1 === currentDecision;
                    const isCompleted = index + 1 < currentDecision;

                    return (
                      <div
                        key={dp.number}
                        className={`flex items-center gap-2 p-2 rounded text-sm ${
                          isCurrent
                            ? "bg-primary/10 text-primary font-medium"
                            : isCompleted
                            ? "text-muted-foreground line-through"
                            : "text-muted-foreground"
                        }`}
                        data-testid={`decision-point-${dp.number}`}
                      >
                        <Badge
                          variant={isCurrent ? "default" : isCompleted ? "secondary" : "outline"}
                          className="shrink-0"
                        >
                          {dp.number}
                        </Badge>
                        <span className="truncate">
                          {dp.format === "multiple_choice"
                            ? "Orientación"
                            : dp.number === 2
                            ? "Análisis"
                            : "Integración"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {reflectionPrompt && (
            <>
              <Separator />
              <Card className="p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="font-medium text-sm">Reflexión Final</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {reflectionPrompt}
                </p>
              </Card>
            </>
          )}

          <div className="text-xs text-muted-foreground text-center pt-4">
            Progreso: Decisión {currentDecision} de {totalDecisions}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
