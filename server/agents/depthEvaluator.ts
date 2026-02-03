import { generateChatCompletion, SupportedModel } from "../openai";
import type { AgentContext, DepthEvaluatorOutput } from "./types";
import { HARD_PROHIBITIONS, MENTOR_TONE, MISUSE_HANDLING } from "./guardrails";

/**
 * POC S4.1: VERY LENIENT depth evaluator
 * Priority: Smooth completion + authentic reasoning > perfect answers
 * 
 * ONLY request revision for truly empty/meaningless responses
 * Accept short but relevant responses
 */
export const DEFAULT_DEPTH_EVALUATOR_PROMPT = `Eres un EVALUADOR MUY PERMISIVO para ScenarioX.

${HARD_PROHIBITIONS}

${MENTOR_TONE}

${MISUSE_HANDLING}

REGLA PRINCIPAL: ACEPTA la gran mayoría de respuestas. Solo pide revisión en casos extremos.

ACEPTA INMEDIATAMENTE (isDeepEnough = true):
- Cualquier respuesta que mencione la decisión tomada
- Justificaciones breves como "porque es más seguro" o "para proteger al equipo"
- Respuestas de 1-2 oraciones que muestren engagement
- Selección de opción + cualquier explicación, por corta que sea
- "Elijo A porque me parece mejor para el cliente"
- Respuestas que intenten abordar el caso aunque sean incompletas

SOLO PIDE REVISIÓN (isDeepEnough = false) SI:
- La respuesta es literalmente vacía o dice solo "no sé" sin más
- Es texto completamente sin relación con el caso (ej: "me gusta el helado")
- El estudiante solo copió la opción sin agregar NADA

PRIORIDAD POC: Fluidez de experiencia > Profundidad perfecta
La simulación DEBE fluir. No queremos frustrar al estudiante con loops de revisión.

SI NECESITAS pedir revisión, sé muy breve y amable:
"Entiendo tu elección. ¿Podrías agregar brevemente por qué tomaste esta decisión?"

FORMATO DE SALIDA (JSON):
{
  "isDeepEnough": true/false,
  "revisionPrompt": "<solo si isDeepEnough=false, máximo 1 oración>",
  "missingConsiderations": [],
  "strengthsAcknowledged": "<qué hizo bien>"
}`;

// POC S4.1: Only 1 revision max to keep flow smooth
const MAX_REVISIONS = 1;

export async function evaluateDepth(
  context: AgentContext,
  revisionAttempts: number = 0,
  options?: { customPrompt?: string; model?: SupportedModel }
): Promise<DepthEvaluatorOutput> {
  // POC: Auto-accept after just 1 revision attempt
  if (revisionAttempts >= MAX_REVISIONS) {
    return {
      isDeepEnough: true,
      strengthsAcknowledged: "El estudiante ha compartido su perspectiva",
    };
  }
  
  // POC S4.1: Quick accept for any input with minimal content
  const inputLength = context.studentInput?.trim().length || 0;
  if (inputLength >= 15) {
    // Any input 15+ chars that made it past validation is good enough
    return {
      isDeepEnough: true,
      strengthsAcknowledged: "El estudiante ha proporcionado su respuesta",
    };
  }

  // Get current decision point configuration
  const currentDecisionNum = context.currentDecision || 1;
  const decisionPoint = context.decisionPoints?.find(dp => dp.number === currentDecisionNum);
  
  // Build context about what this decision requires
  const requiresJustification = decisionPoint?.requiresJustification ?? true;
  const includesReflection = decisionPoint?.includesReflection ?? false;
  const decisionFormat = decisionPoint?.format || "written";

  const recentHistory = context.history.slice(-4).map(h => `${h.role}: ${h.content}`).join("\n");

  const userPrompt = `
CONTEXTO DE LA SIMULACIÓN:
Escenario: "${context.scenario.title}"
Dominio: ${context.scenario.domain}
Rol del estudiante: ${context.scenario.role}
Objetivo: ${context.scenario.objective}
${context.scenario.situationBackground ? `Situación: ${context.scenario.situationBackground}` : ""}

CONFIGURACIÓN DE ESTA DECISIÓN:
- Número de decisión: ${currentDecisionNum} de ${context.totalDecisions || 3}
- Formato: ${decisionFormat}
- Requiere justificación: ${requiresJustification ? "Sí" : "No"}
- Incluye reflexión: ${includesReflection ? "Sí" : "No"}
${decisionPoint?.prompt ? `- Pregunta planteada: "${decisionPoint.prompt}"` : ""}

HISTORIAL RECIENTE:
${recentHistory}

RESPUESTA DEL ESTUDIANTE: "${context.studentInput}"

INTENTOS DE REVISIÓN PREVIOS: ${revisionAttempts}

TAREA:
Evalúa si esta respuesta tiene suficiente profundidad para proceder.
${revisionAttempts > 0 ? "NOTA: El estudiante ya revisó su respuesta. Sé más permisivo en esta evaluación." : ""}
${!requiresJustification ? "NOTA: Esta decisión NO requiere justificación obligatoria, sé más permisivo." : ""}
${currentDecisionNum === (context.totalDecisions || 3) ? `
REQUISITO ESPECIAL - DECISIÓN FINAL (INTEGRATIVA):
Esta es la última decisión del escenario. El estudiante DEBE demostrar SÍNTESIS de:
1. Información previa del caso y decisiones anteriores
2. Trade-offs considerados a lo largo de la simulación
3. Cómo las consecuencias previas influyen en esta decisión final
Si la respuesta no hace referencia a decisiones anteriores o no integra el contexto acumulado, solicita revisión pidiendo que conecte esta decisión con lo aprendido en las decisiones previas.` : ""}`;

  const systemPrompt = options?.customPrompt || DEFAULT_DEPTH_EVALUATOR_PROMPT;

  try {
    const response = await generateChatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json", maxTokens: 512, model: options?.model }
    );

    const parsed = JSON.parse(response);
    
    return {
      isDeepEnough: parsed.isDeepEnough === true,
      revisionPrompt: parsed.isDeepEnough ? undefined : parsed.revisionPrompt,
      missingConsiderations: parsed.missingConsiderations || [],
      strengthsAcknowledged: parsed.strengthsAcknowledged,
    };
  } catch (error) {
    console.error("DepthEvaluator agent error:", error);
    // On error, accept the answer to avoid blocking the student
    return {
      isDeepEnough: true,
      strengthsAcknowledged: "Respuesta procesada",
    };
  }
}
