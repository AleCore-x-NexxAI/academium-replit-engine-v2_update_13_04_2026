import { generateChatCompletion, SupportedModel } from "../openai";
import {
  SignalQuality,
  RDSBand,
  type SignalExtractionResult,
  type DecisionEvidenceLog,
  type AgentContext,
  computeRDS,
  classifyRDSBand,
  mapCompetencyEvidence,
} from "./types";
import { getLanguageDirective } from "./guardrails";
import { DIMENSION_TO_SIGNAL, type AcademicDimension } from "@shared/schema";

/**
 * Phase 6 §2: dimension-weighted marginal-evidence promotion. When the LLM
 * scores the dimension-mapped signal as WEAK (1) but the student input
 * contains marginal evidence cues for that dimension, promote to PRESENT (2).
 * Hard cap at 2 — never above. Non-mapped signals are untouched.
 */
const MARGINAL_CUES: Record<AcademicDimension, { es: RegExp[]; en: RegExp[] }> = {
  analytical: {
    es: [/\b(porque|debido a|dado que|los datos|la evidencia|el análisis|según|indica|sugiere|tendencia|patrón|causa|efecto|correlación|impacto)\b/i],
    en: [/\b(because|due to|since|the data|the evidence|the analysis|according to|indicates|suggests|trend|pattern|cause|effect|correlation|impact)\b/i],
  },
  strategic: {
    es: [/\b(prioridad|priorizar|enfocar|elegir|decidir|alternativa|opción|dirección|objetivo|meta|primero|principalmente|en lugar de)\b/i],
    en: [/\b(priority|prioritize|focus|choose|decide|alternative|option|direction|goal|objective|first|primarily|instead of)\b/i],
  },
  stakeholder: {
    es: [/\b(equipo|cliente|empleado|inversionista|usuario|comunidad|proveedor|junta|gerencia|familia|ingeniería|marketing|ventas|operaciones|el personal)\b/i],
    en: [/\b(team|customer|employee|investor|user|community|supplier|board|management|family|engineering|marketing|sales|operations|the staff)\b/i],
  },
  ethical: {
    es: [/\b(justo|injusto|correcto|incorrecto|ético|deber|obligación|responsabilidad|transparencia|honestidad|integridad|principio|valor|debería)\b/i],
    en: [/\b(fair|unfair|right|wrong|ethical|duty|obligation|responsibility|transparency|honesty|integrity|principle|value|ought)\b/i],
  },
  tradeoff: {
    es: [/\b(pero|aunque|sin embargo|costo|sacrificio|a cambio|perder|ceder|riesgo|consecuencia|implicación|por otro lado|desventaja|contrapartida)\b/i],
    en: [/\b(but|although|however|cost|sacrifice|in exchange|lose|give up|risk|consequence|implication|on the other hand|downside|tradeoff)\b/i],
  },
};

function detectMarginalEvidence(
  studentInput: string,
  dim: AcademicDimension,
  language: "es" | "en",
): { found: boolean; snippet: string } {
  const cues = MARGINAL_CUES[dim]?.[language] ?? [];
  for (const re of cues) {
    const m = studentInput.match(re);
    if (m) {
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 20);
      const end = Math.min(studentInput.length, idx + m[0].length + 40);
      return { found: true, snippet: studentInput.slice(start, end).trim() };
    }
  }
  return { found: false, snippet: "" };
}

function getSignalExtractionPrompt(language: "es" | "en"): string {
  if (language === "en") {
    return `You are a SIGNAL EXTRACTOR for an educational business simulation. You analyze student decision text to detect reasoning signals.

Extract EXACTLY 5 signals from the student's response. Each signal is scored independently on a 4-level scale:
- STRONG (3): Clear, specific, case-anchored evidence
- PRESENT (2): Evidence exists but is generic or vague
- WEAK (1): Minimal or hedged evidence
- ABSENT (0): No evidence at all

THE 5 SIGNALS:

1. **Intent** — Does the student commit to a clear direction/priority/action?
   STRONG: Specific, directional, case-anchored ("I will prioritize client retention by offering...")
   PRESENT: Directional but generic ("I choose option A")
   WEAK: Hedged ("maybe we could...", "perhaps...")
   ABSENT: No commitment to any direction
   FALSE POSITIVE: A question is NOT intent. "Should we reduce costs?" = ABSENT, not PRESENT.

2. **Justification** — Does the student provide reasoning?
   STRONG: Case-specific causal chain ("Because our Q3 revenue dropped and the team is burned out, we need...")
   PRESENT: General causal reasoning ("Because it's important for the team")
   WEAK: Circular or merely asserted ("It's the right thing to do")
   ABSENT: No reasoning provided
   FALSE POSITIVE: Restating a case fact is NOT justification. Tautology ("X because X") = WEAK not PRESENT.

3. **Tradeoff Awareness** — Does the student acknowledge a cost or sacrifice?
   STRONG: Specific named tradeoff with consequence ("This will hurt short-term revenue but...")
   PRESENT: Acknowledged but vague ("There are some downsides")
   WEAK: Generic ("pros and cons")
   ABSENT: No downside mentioned
   NOTE: Always detect regardless of scenario configuration.

4. **Stakeholder Awareness** — Does the student consider impact on specific groups?
   STRONG: Named stakeholder + specific impact + why it matters ("The engineering team will face overtime, affecting morale")
   PRESENT: Named stakeholder with general impact ("The team will be affected")
   WEAK: Implied/generic ("the team", "people")
   ABSENT: No stakeholder consideration
   FALSE POSITIVE: "Everyone" or "the company" does NOT qualify as a named stakeholder.
   FALSE POSITIVE: Student referring to themselves is NOT stakeholder awareness.

5. **Ethical Awareness** — Does the student surface a principle/obligation/fairness concern?
   STRONG: Applied ethical principle with case connection ("We have a duty of transparency to our customers...")
   PRESENT: Acknowledged but generic ("It's about doing the right thing")
   WEAK: Abstract moral language ("it's important to be good")
   ABSENT: No ethical dimension
   NOTE: Recognizing ethical TENSION counts as strong ethical awareness.
   FALSE POSITIVE: Keyword "ethical" alone does NOT qualify. Must demonstrate actual ethical reasoning.

CRITICAL RULES:
- Grammar/spelling are NEVER scoring criteria
- Word count is NEVER a factor
- Score each signal INDEPENDENTLY — one signal's score does not affect another
- If unsure between two levels, choose the LOWER level

For every signal, return all four fields. 'confidence' reflects certainty in your quality assignment, not student confidence. 'marginal_evidence' names the specific word(s) or phrase(s) that tipped your decision.

Return ONLY valid JSON:
{
  "intent": {
    "quality": 0-3,
    "extracted_text": "exact quote from student response, or '' if absent",
    "confidence": "high | medium | low — how confident you are in the quality score",
    "marginal_evidence": "one short sentence describing what specific token/phrase drove the quality decision, or '' if the signal is clearly ABSENT"
  },
  "justification": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "tradeoffAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "stakeholderAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "ethicalAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." }
}`;
  }

  return `Eres un EXTRACTOR DE SEÑALES para una simulación educativa de negocios. Analizas el texto de decisión del estudiante para detectar señales de razonamiento.

Extrae EXACTAMENTE 5 señales de la respuesta del estudiante. Cada señal se puntúa independientemente en una escala de 4 niveles:
- STRONG (3): Evidencia clara, específica, anclada al caso
- PRESENT (2): Existe evidencia pero es genérica o vaga
- WEAK (1): Evidencia mínima o con reservas
- ABSENT (0): Sin evidencia alguna

LAS 5 SEÑALES:

1. **Intent (Intención)** — ¿El estudiante se compromete con una dirección/prioridad/acción clara?
   STRONG: Específico, direccional, anclado al caso ("Voy a priorizar la retención de clientes ofreciendo...")
   PRESENT: Direccional pero genérico ("Elijo la opción A")
   WEAK: Con reservas ("quizás podríamos...", "tal vez...")
   ABSENT: Sin compromiso con ninguna dirección
   FALSO POSITIVO: Una pregunta NO es intención. "¿Deberíamos reducir costos?" = ABSENT, no PRESENT.

2. **Justification (Justificación)** — ¿El estudiante proporciona razonamiento?
   STRONG: Cadena causal específica del caso ("Porque nuestros ingresos del Q3 cayeron y el equipo está agotado...")
   PRESENT: Razonamiento causal general ("Porque es importante para el equipo")
   WEAK: Circular o meramente afirmado ("Es lo correcto")
   ABSENT: Sin razonamiento
   FALSO POSITIVO: Repetir un hecho del caso NO es justificación. Tautología ("X porque X") = WEAK no PRESENT.

3. **Tradeoff Awareness (Conciencia de Trade-offs)** — ¿El estudiante reconoce un costo o sacrificio?
   STRONG: Trade-off nombrado con consecuencia ("Esto afectará los ingresos a corto plazo pero...")
   PRESENT: Reconocido pero vago ("Hay algunas desventajas")
   WEAK: Genérico ("pros y contras")
   ABSENT: Sin mención de desventajas
   NOTA: Siempre detectar independientemente de la configuración del escenario.

4. **Stakeholder Awareness (Conciencia de Stakeholders)** — ¿El estudiante considera impacto en grupos específicos?
   STRONG: Stakeholder nombrado + impacto específico + por qué importa ("El equipo de ingeniería enfrentará horas extra, afectando su moral")
   PRESENT: Stakeholder nombrado con impacto general ("El equipo se verá afectado")
   WEAK: Implícito/genérico ("el equipo", "la gente")
   ABSENT: Sin consideración de stakeholders
   FALSO POSITIVO: "Todos" o "la empresa" NO califican como stakeholder nombrado.
   FALSO POSITIVO: El estudiante refiriéndose a sí mismo NO es conciencia de stakeholders.

5. **Ethical Awareness (Conciencia Ética)** — ¿El estudiante expone un principio/obligación/preocupación de justicia?
   STRONG: Principio ético aplicado con conexión al caso ("Tenemos el deber de transparencia con nuestros clientes...")
   PRESENT: Reconocido pero genérico ("Se trata de hacer lo correcto")
   WEAK: Lenguaje moral abstracto ("es importante ser bueno")
   ABSENT: Sin dimensión ética
   NOTA: Reconocer una TENSIÓN ética cuenta como conciencia ética fuerte.
   FALSO POSITIVO: La palabra "ético" sola NO califica. Debe demostrar razonamiento ético real.

REGLAS CRÍTICAS:
- La gramática/ortografía NUNCA son criterios de puntuación
- La cantidad de palabras NUNCA es un factor
- Puntúa cada señal INDEPENDIENTEMENTE — la puntuación de una señal no afecta a otra
- Si no estás seguro entre dos niveles, elige el nivel MÁS BAJO

Para cada señal, devuelve los cuatro campos. 'confidence' refleja qué tan seguro estás de la calidad asignada, no la confianza del estudiante. 'marginal_evidence' nombra el/los token(s) o frase(s) específicos que determinaron tu decisión. IMPORTANTE: el valor de 'confidence' debe ser literalmente "high", "medium" o "low" en inglés.

Devuelve SOLO JSON válido:
{
  "intent": {
    "quality": 0-3,
    "extracted_text": "cita exacta de la respuesta del estudiante, o '' si ausente",
    "confidence": "high | medium | low — qué tan seguro estás de la calidad asignada",
    "marginal_evidence": "una oración corta describiendo el token/frase específico que determinó la calidad, o '' si la señal está claramente AUSENTE"
  },
  "justification": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "tradeoffAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "stakeholderAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." },
  "ethicalAwareness": { "quality": 0-3, "extracted_text": "...", "confidence": "high|medium|low", "marginal_evidence": "..." }
}`;
}

function clampQuality(val: any): SignalQuality {
  const n = typeof val === "number" ? val : parseInt(val, 10);
  if (isNaN(n) || n <= 0) return SignalQuality.ABSENT;
  if (n === 1) return SignalQuality.WEAK;
  if (n === 2) return SignalQuality.PRESENT;
  return SignalQuality.STRONG;
}

function parseSignalResult(parsed: any): SignalExtractionResult {
  // §6.5: pass through confidence and marginal_evidence. The prompt requests
  // both on every signal; we're defensive here in case the LLM omits them.
  const validConf = new Set(["high", "medium", "low"]);
  const missingConf = ["intent","justification","tradeoffAwareness","stakeholderAwareness","ethicalAwareness"]
    .filter(k => !validConf.has(parsed?.[k]?.confidence));
  if (missingConf.length > 0) {
    console.warn(`[signalExtractor] LLM did not return a valid confidence (high|medium|low) for: ${missingConf.join(", ")}`);
  }
  const passOptional = (raw: any) => {
    const out: { confidence?: "high" | "medium" | "low"; marginal_evidence?: string } = {};
    if (raw?.confidence === "high" || raw?.confidence === "medium" || raw?.confidence === "low") {
      out.confidence = raw.confidence;
    }
    if (typeof raw?.marginal_evidence === "string" && raw.marginal_evidence.length > 0) {
      out.marginal_evidence = raw.marginal_evidence;
    }
    return out;
  };
  return {
    intent: {
      quality: clampQuality(parsed.intent?.quality),
      extracted_text: parsed.intent?.extracted_text || "",
      ...passOptional(parsed.intent),
    },
    justification: {
      quality: clampQuality(parsed.justification?.quality),
      extracted_text: parsed.justification?.extracted_text || "",
      ...passOptional(parsed.justification),
    },
    tradeoffAwareness: {
      quality: clampQuality(parsed.tradeoffAwareness?.quality),
      extracted_text: parsed.tradeoffAwareness?.extracted_text || "",
      ...passOptional(parsed.tradeoffAwareness),
    },
    stakeholderAwareness: {
      quality: clampQuality(parsed.stakeholderAwareness?.quality),
      extracted_text: parsed.stakeholderAwareness?.extracted_text || "",
      ...passOptional(parsed.stakeholderAwareness),
    },
    ethicalAwareness: {
      quality: clampQuality(parsed.ethicalAwareness?.quality),
      extracted_text: parsed.ethicalAwareness?.extracted_text || "",
      ...passOptional(parsed.ethicalAwareness),
    },
  };
}

function defaultSignals(): SignalExtractionResult {
  const absent = { quality: SignalQuality.ABSENT, extracted_text: "" };
  return {
    intent: absent,
    justification: absent,
    tradeoffAwareness: absent,
    stakeholderAwareness: absent,
    ethicalAwareness: absent,
  };
}

export async function extractSignals(
  context: AgentContext,
  options?: { model?: SupportedModel }
): Promise<DecisionEvidenceLog> {
  const language = context.language || "es";

  const previousDecisions = context.history
    .filter(h => h.role === "user")
    .map((h, i) => `Decision ${i + 1}: "${h.content}"`)
    .join("\n");

  const stakeholderList = context.scenario.stakeholders?.length
    ? `KEY STAKEHOLDERS: ${context.scenario.stakeholders.map(s => `${s.name} (${s.role})`).join(", ")}`
    : "";

  const userPrompt = `SCENARIO: "${context.scenario.title}"
DOMAIN: ${context.scenario.domain}
ROLE: ${context.scenario.role}
OBJECTIVE: ${context.scenario.objective}
${context.scenario.companyName ? `COMPANY: ${context.scenario.companyName}` : ""}
${context.scenario.situationBackground ? `SITUATION: ${context.scenario.situationBackground}` : ""}
${stakeholderList}
${context.scenario.keyConstraints?.length ? `CONSTRAINTS: ${context.scenario.keyConstraints.join("; ")}` : ""}

${previousDecisions ? `PREVIOUS DECISIONS:\n${previousDecisions}\n` : ""}

CURRENT STUDENT INPUT (Decision ${context.currentDecision || context.turnCount + 1}):
"${context.studentInput}"

Extract the 5 signals. Return JSON only.`;

  try {
    const systemPrompt = getSignalExtractionPrompt(language) + getLanguageDirective(language);

    const response = await generateChatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        responseFormat: "json",
        maxTokens: 512,
        model: "gpt-4o-mini",
        agentName: "signalExtractor",
        sessionId: parseInt(context.sessionId) || undefined,
      }
    );

    const parsed = JSON.parse(response);
    const signals = parseSignalResult(parsed);

    // Phase 6 §2: dimension-weighted promotion. Look up the decision's primary
    // dimension; if the mapped signal scored exactly WEAK (1) and we find a
    // marginal-evidence cue in the student input, promote that signal to
    // PRESENT (2) and populate marginal_evidence. Hard cap at 2.
    const currentDecisionNum = context.currentDecision || context.turnCount + 1;
    const decisionPoint = context.decisionPoints?.find(dp => dp.number === currentDecisionNum);
    const primaryDim = decisionPoint?.primaryDimension as AcademicDimension | undefined;
    if (primaryDim) {
      const sigKey = DIMENSION_TO_SIGNAL[primaryDim] as keyof SignalExtractionResult;
      const sig = signals[sigKey];
      if (sig && sig.quality === SignalQuality.WEAK) {
        const { found, snippet } = detectMarginalEvidence(context.studentInput, primaryDim, language);
        if (found) {
          signals[sigKey] = {
            ...sig,
            quality: SignalQuality.PRESENT,
            marginal_evidence: snippet,
          };
        }
      }
    }

    const rds = computeRDS(signals);
    const rdsBand = classifyRDSBand(rds);
    const competencyEvidence = mapCompetencyEvidence(signals);

    return {
      signals_detected: signals,
      rds_score: rds,
      rds_band: rdsBand,
      competency_evidence: competencyEvidence,
      raw_signal_scores: {
        intent: signals.intent.quality,
        justification: signals.justification.quality,
        tradeoffAwareness: signals.tradeoffAwareness.quality,
        stakeholderAwareness: signals.stakeholderAwareness.quality,
        ethicalAwareness: signals.ethicalAwareness.quality,
      },
    };
  } catch (error) {
    console.error("[SignalExtractor] Error extracting signals, using defaults:", error);
    const signals = defaultSignals();
    const rds = computeRDS(signals);
    const rdsBand = classifyRDSBand(rds);
    const competencyEvidence = mapCompetencyEvidence(signals);

    return {
      signals_detected: signals,
      rds_score: rds,
      rds_band: rdsBand,
      competency_evidence: competencyEvidence,
      raw_signal_scores: {
        intent: signals.intent.quality,
        justification: signals.justification.quality,
        tradeoffAwareness: signals.tradeoffAwareness.quality,
        stakeholderAwareness: signals.stakeholderAwareness.quality,
        ethicalAwareness: signals.ethicalAwareness.quality,
      },
    };
  }
}
