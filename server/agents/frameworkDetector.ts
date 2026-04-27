import { z } from "zod";
import type { CaseFramework, FrameworkDetection } from "@shared/schema";
import type { SignalExtractionResult } from "./types";
import { generateChatCompletion } from "../openai";
import { getRegistryEntryById } from "./frameworkRegistry";

const MIN_QUALITY_MAP: Record<string, number> = { WEAK: 1, PRESENT: 2, STRONG: 3 };

// Phase 2: prohibited evaluative language for the semantic check `explanation`
// field. We do not regenerate; we sanitize because the field is professor-facing
// reasoning text, not student-facing copy.
const PROHIBITED_TOKENS_EN = ["correct", "incorrect", "wrong", "should", "ought", "must", "optimal", "best practice", "right answer", "good answer", "bad answer"];
const PROHIBITED_TOKENS_ES = ["correcto", "incorrecto", "equivocado", "debería", "deberia", "debe", "óptimo", "optimo", "mejor práctica", "mejor practica", "respuesta correcta", "buena respuesta", "mala respuesta"];

function sanitizeExplanation(text: string, language: "es" | "en"): string {
  if (!text) return "";
  const tokens = language === "en" ? PROHIBITED_TOKENS_EN : PROHIBITED_TOKENS_ES;
  let out = text;
  for (const tok of tokens) {
    const re = new RegExp(`\\b${escapeRegex(tok)}\\b`, "gi");
    out = out.replace(re, "—");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Exported for unit testing only — not part of the public API.
 * Normalize a string for loose substring matching.
 * Applies NFKC, lowercase, smart-quote folding, dash folding, whitespace
 * collapse, and leading/trailing punctuation strip so that LLM-normalised
 * quotes (different capitalisation, smart quotes, collapsed whitespace, trailing
 * period) still satisfy the anti-hallucination guard.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    // Fold smart/curly single quotes to ASCII apostrophe
    .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035\u02bc]/g, "'")
    // Fold smart/curly double quotes to ASCII quote
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"')
    // Fold em/en dashes and horizontal bar to ASCII hyphen
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
    // Collapse whitespace (tabs, newlines, multiple spaces)
    .replace(/\s+/g, " ")
    // Strip leading and trailing sentence-ending punctuation only.
    // We target periods, commas, semicolons, colons, and ellipsis characters —
    // NOT quotes or apostrophes, which may be meaningful parts of the text and
    // are folded identically on both sides of the comparison anyway.
    .replace(/^[\s.,;:!?\u2026]+/, "")
    .replace(/[\s.,;:!?\u2026]+$/, "")
    .trim();
}

/**
 * Return true when `quote` is found inside `input` using normalised comparison.
 * Rejects empty quotes (hallucination guard still intact — just tolerates
 * normal LLM typographic variation).
 */
function normalizedIncludes(input: string, quote: string): boolean {
  if (!quote) return false;
  const normInput = normalizeForMatch(input);
  const normQuote = normalizeForMatch(quote);
  if (!normQuote) return false;
  return normInput.includes(normQuote);
}

/**
 * Hydrate a CaseFramework's rubric fields from the canonical registry when the
 * case record is missing them.  Returns a new object (never mutates the
 * original); returns the original unchanged when nothing needs hydrating.
 */
function hydrateFromRegistry(fw: CaseFramework, language: "es" | "en"): CaseFramework {
  const hasDesc = !!fw.conceptualDescription?.trim();
  const hasSignals = !!(fw.recognitionSignals && fw.recognitionSignals.length > 0);
  if (hasDesc && hasSignals) return fw;
  if (!fw.canonicalId) return fw;

  const entry = getRegistryEntryById(fw.canonicalId);
  if (!entry) return fw;

  const isEn = language === "en";
  return {
    ...fw,
    conceptualDescription: hasDesc
      ? fw.conceptualDescription
      : (isEn ? entry.conceptualDescription_en : entry.conceptualDescription_es),
    recognitionSignals: hasSignals
      ? fw.recognitionSignals
      : (isEn ? entry.recognitionSignals_en : entry.recognitionSignals_es),
  };
}

/**
 * A keyword is a Tier-1 trigger only if it is multi-word (contains a space).
 * Single-word terms like "focus", "strategy", "niche" are too generic and would
 * short-circuit the semantic tier, producing false positives.  They are still
 * used in the Tier-3 signal-pattern fallback via additionalKeywords / domainKeywords.
 */
function isTier1Keyword(kw: string): boolean {
  return kw.trim().includes(" ");
}

/**
 * Tier 2 four-tier evidence scale (TASK 3 §3.2).
 *
 *   "none"            — framework's reasoning pattern is absent.
 *   "weak_implicit"   — one element of the pattern appears; rest do not.
 *   "strong_implicit" — multiple elements present; structurally mirrors the framework.
 *   "explicit"        — the student names the framework or canonical vocabulary
 *                       (rare in Tier 2 — Tier 1 normally catches this).
 *
 * The LLM returns `evidence_level`. The downstream pipeline maps it to
 * `{ level, confidence }` via `_mapEvidenceLevelToDetection`. The §T-003B
 * word-count floors are applied AFTER the mapping.
 */
export type EvidenceLevel = "none" | "weak_implicit" | "strong_implicit" | "explicit";

/**
 * Zod schema for the LLM's per-framework verdict (TASK 3 §3.4).
 * Used by `semanticFrameworkCheck` to fail-loud on malformed LLM output rather
 * than silently coercing — a malformed verdict surfaces a structured warning
 * and is treated as `evidence_level: "none"` (the safe default per §3.3 rule 2).
 */
const _SemanticVerdictSchema = z.object({
  framework_id: z.string().min(1),
  evidence_level: z.enum(["none", "weak_implicit", "strong_implicit", "explicit"]),
  quotedReasoning: z.string().default(""),
  explanation: z.string().default(""),
});

interface SemanticVerdict {
  framework_id: string;
  evidence_level: EvidenceLevel;
  quotedReasoning: string;
  explanation: string;
}

/**
 * Map the LLM's four-tier evidence_level to the FrameworkDetection
 * (level, confidence) pair used downstream. Exported for unit testing only —
 * not part of the public API.
 */
export function _mapEvidenceLevelToDetection(level: string): {
  level: "explicit" | "implicit" | "not_evidenced";
  confidence: "high" | "medium" | "low" | undefined;
} {
  switch (level) {
    case "explicit":
      return { level: "explicit", confidence: "high" };
    case "strong_implicit":
      return { level: "implicit", confidence: "medium" };
    case "weak_implicit":
      return { level: "implicit", confidence: "low" };
    case "none":
    default:
      return { level: "not_evidenced", confidence: undefined };
  }
}

/**
 * Phase 2 (§4.4): batched semantic check across tracked frameworks.
 * One gpt-4o-mini call per turn covering all candidates. JSON output, ≤256 tokens
 * per framework slot kept low so total stays inside the 1.5s latency budget.
 *
 * Frameworks without a usable rubric (no conceptualDescription and no
 * recognitionSignals after registry hydration) are excluded from the LLM call
 * and logged so the gap is visible.
 */
export async function semanticFrameworkCheck(
  studentInput: string,
  frameworks: CaseFramework[],
  language: "es" | "en",
): Promise<SemanticVerdict[]> {
  if (frameworks.length === 0) return [];

  // Partition into usable (has rubric) and unusable (no rubric after hydration).
  const usable: CaseFramework[] = [];
  const noRubric: CaseFramework[] = [];
  for (const fw of frameworks) {
    const hasDesc = !!fw.conceptualDescription?.trim();
    const hasSignals = !!(fw.recognitionSignals && fw.recognitionSignals.length > 0);
    if (hasDesc || hasSignals) {
      usable.push(fw);
    } else {
      noRubric.push(fw);
    }
  }

  if (noRubric.length > 0) {
    const names = noRubric.map((fw) => `${fw.name}(${fw.canonicalId ?? fw.id})`).join(", ");
    console.warn(
      `[semanticFrameworkCheck] Skipping semantic tier for ${noRubric.length} framework(s) with no rubric: ${names}`,
    );
  }

  if (usable.length === 0) return [];

  const isEn = language === "en";
  const list = usable
    .map((fw, i) => {
      const desc = fw.conceptualDescription?.trim() || (isEn
        ? `A framework called "${fw.name}".`
        : `Un marco llamado "${fw.name}".`);
      const recog = fw.recognitionSignals && fw.recognitionSignals.length > 0
        ? (isEn ? `\n  Recognition signals: ${fw.recognitionSignals.join("; ")}` : `\n  Señales de reconocimiento: ${fw.recognitionSignals.join("; ")}`)
        : "";
      return `${i + 1}. id=${fw.id} | ${fw.name}\n  ${isEn ? "Description" : "Descripción"}: ${desc}${recog}`;
    })
    .join("\n");

  const systemPrompt = isEn
    ? `You determine whether a student's reasoning APPLIES specific analytical frameworks. You do not judge whether the student is correct or wrong — only whether the framework's reasoning pattern shows up in their text. You do not need the student to name the framework.

DECISION SCALE — pick exactly ONE for each framework:

- "none": the framework's reasoning pattern is absent. The student may discuss the same problem domain without using this framework's lens. Default to "none" if uncertain.

- "weak_implicit": one element of the framework's pattern appears, but the rest don't, or the alignment is partial enough that it could be coincidence. Use this when the student's reasoning hints at the framework but doesn't anchor on it.

- "strong_implicit": the student's reasoning is clearly structured around this framework's pattern, with multiple elements present, even though they don't name it. A professor reading the response would say "this student is thinking like <framework>." Reserve this for unambiguous structural mirroring.

- "explicit": the student names the framework directly, OR uses canonical framework vocabulary correctly. Most explicit cases are caught upstream (keyword tier); only emit "explicit" when you see a clear paraphrase of the framework's name or terminology that the keyword tier missed.

CRITICAL RULES TO PREVENT MISCALIBRATION:

1. POSITIVE EVIDENCE REQUIRED. To label "weak_implicit" or stronger, you MUST identify a specific phrase or sentence in the student's text that EXEMPLIFIES the framework's reasoning. Domain-shared vocabulary alone (e.g., "competitor" appearing in a Porter-eligible scenario) is NOT positive evidence — Porter's reasoning structure must show up.

2. NO BIAS TOWARD APPLICATION. Default to "none" when in doubt. False positives (saying a student applied a framework they didn't) are as harmful as false negatives. The professor uses this signal to grade — getting it wrong in either direction misrepresents the student.

3. MULTIPLE FRAMEWORKS, INDEPENDENT JUDGMENTS. The student's text may apply zero, one, or several frameworks. Judge each one independently. Do not assume that if one framework applies, others probably do too.

4. quotedReasoning MUST be a verbatim substring of the student's input — no paraphrase, no summary. Empty if evidence_level is "none".

5. explanation describes which conceptual element the student exercised (or, for "none", briefly says why the framework's pattern is absent). Observation only — never use evaluative language ("correct", "should have", "ideal", "missed an opportunity").`
    : `Determinas si el razonamiento del estudiante APLICA marcos analíticos específicos. No juzgas si el estudiante está en lo correcto o equivocado — solo si el patrón de razonamiento del marco aparece en su texto. No es necesario que el estudiante nombre el marco.

ESCALA DE DECISIÓN — elige exactamente UNA para cada marco:

- "none": el patrón de razonamiento del marco está ausente. El estudiante puede discutir el mismo dominio sin usar la lente de este marco. Por defecto usa "none" cuando haya duda.

- "weak_implicit": aparece un elemento del patrón del marco, pero los demás no, o la alineación es lo suficientemente parcial como para ser coincidencia. Úsalo cuando el razonamiento del estudiante insinúa el marco pero no se ancla en él.

- "strong_implicit": el razonamiento del estudiante está claramente estructurado en torno al patrón de este marco, con varios elementos presentes, aunque no lo nombre. Un profesor que lea la respuesta diría "este estudiante está pensando como <marco>". Reserva esta etiqueta para un reflejo estructural inequívoco.

- "explicit": el estudiante nombra el marco directamente, O usa vocabulario canónico del marco de forma correcta. La mayoría de los casos explícitos los captura el filtro de palabras clave; solo emite "explicit" cuando veas una paráfrasis clara del nombre o terminología del marco que el tier de palabras clave dejó pasar.

REGLAS CRÍTICAS PARA EVITAR MISCALIBRACIÓN:

1. EVIDENCIA POSITIVA OBLIGATORIA. Para etiquetar "weak_implicit" o superior, DEBES identificar una frase u oración específica del texto del estudiante que EJEMPLIFIQUE el razonamiento del marco. El vocabulario compartido del dominio por sí solo (p. ej., "competidor" en un escenario apto para Porter) NO es evidencia positiva — la estructura de razonamiento de Porter debe aparecer.

2. SIN SESGO HACIA LA APLICACIÓN. Por defecto usa "none" cuando haya duda. Los falsos positivos (decir que un estudiante aplicó un marco que no usó) son tan dañinos como los falsos negativos. El profesor usa esta señal para calificar — equivocarse en cualquier dirección tergiversa al estudiante.

3. VARIOS MARCOS, JUICIOS INDEPENDIENTES. El texto del estudiante puede aplicar cero, uno o varios marcos. Juzga cada uno de forma independiente. No asumas que si un marco aplica, los demás probablemente también.

4. quotedReasoning DEBE ser una subcadena literal del input del estudiante — sin paráfrasis, sin resumen. Cadena vacía si evidence_level es "none".

5. explanation describe qué elemento conceptual ejercitó el estudiante (o, para "none", explica brevemente por qué el patrón del marco está ausente). Solo observación — nunca uses lenguaje evaluativo ("correcto", "debería haber", "ideal", "perdió la oportunidad").

NOTA: los valores literales de evidence_level ("none", "weak_implicit", "strong_implicit", "explicit") DEBEN devolverse en inglés tal cual; el parser los compara como cadenas exactas.`;

  const userPrompt = isEn
    ? `Student input:\n"""${studentInput}"""\n\nFrameworks to evaluate:\n${list}\n\nReturn JSON: {\n  "verdicts": [\n    {\n      "framework_id": "<id from the list>",\n      "evidence_level": "none" | "weak_implicit" | "strong_implicit" | "explicit",\n      "quotedReasoning": "<verbatim substring from student input, or '' if evidence_level is none>",\n      "explanation": "<one short sentence — what conceptual element the student exercised, or why the pattern is absent>"\n    }\n    // ...one verdict per framework, in the same order...\n  ]\n}`
    : `Input del estudiante:\n"""${studentInput}"""\n\nMarcos a evaluar:\n${list}\n\nDevuelve JSON: {\n  "verdicts": [\n    {\n      "framework_id": "<id de la lista>",\n      "evidence_level": "none" | "weak_implicit" | "strong_implicit" | "explicit",\n      "quotedReasoning": "<subcadena literal del input del estudiante, o '' si evidence_level es none>",\n      "explanation": "<una oración corta — qué elemento conceptual ejercitó el estudiante, o por qué el patrón está ausente>"\n    }\n    // ...un veredicto por marco, en el mismo orden...\n  ]\n}`;

  const maxTokens = Math.min(1024, 128 + usable.length * 96);

  let parsed: any;
  try {
    const response = await generateChatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json", maxTokens, model: "gpt-4o-mini", agentName: "semanticFrameworkCheck" },
    );
    parsed = JSON.parse(response);
  } catch (err) {
    const names = usable.map((fw) => fw.name).join(", ");
    console.warn(`[semanticFrameworkCheck] LLM call or JSON parse failed for [${names}]: ${err}`);
    return [];
  }

  if (!Array.isArray(parsed?.verdicts) || parsed.verdicts.length === 0) {
    const names = usable.map((fw) => fw.name).join(", ");
    console.warn(`[semanticFrameworkCheck] Empty or missing verdicts array for [${names}]`);
    return [];
  }

  const verdicts: SemanticVerdict[] = [];
  for (const v of parsed.verdicts) {
    // TASK 3 §3.4: validate the LLM's per-framework verdict against the Zod
    // schema. A schema violation (missing field, unknown evidence_level, wrong
    // type) surfaces a structured warning and the verdict is dropped — the
    // framework will be reported as missing in the post-loop "no verdict
    // returned" warning, which is the safe default per CRITICAL RULE 2.
    const validation = _SemanticVerdictSchema.safeParse(v);
    if (!validation.success) {
      const fid = typeof v?.framework_id === "string" ? v.framework_id : "<unknown>";
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      console.warn(
        `[semanticFrameworkCheck] Schema-invalid verdict for framework_id="${fid}" — dropping. issues=[${issues}]`,
      );
      continue;
    }
    const parsedVerdict = validation.data;
    const fw = usable.find((f) => f.id === parsedVerdict.framework_id);
    if (!fw) continue;

    const evidenceLevel: EvidenceLevel = parsedVerdict.evidence_level;
    const quoted = parsedVerdict.quotedReasoning.trim();
    const explanation = sanitizeExplanation(parsedVerdict.explanation, language);

    // Anti-hallucination guard: any non-"none" verdict must cite a quote that is
    // a substring of the student's input (after typographic normalisation). When
    // the quote is missing or hallucinated, downgrade the verdict to "none" so
    // it falls through to Tier 3 — preserving the same downstream behaviour the
    // old "applied=false" verdict produced.
    if (evidenceLevel !== "none" && !normalizedIncludes(studentInput, quoted)) {
      console.warn(
        `[semanticFrameworkCheck] Rejecting verdict for ${fw.name}: quotedReasoning not found in student input (even after normalisation). quote="${quoted.substring(0, 60)}"`,
      );
      verdicts.push({
        framework_id: fw.id,
        evidence_level: "none",
        quotedReasoning: "",
        explanation,
      });
      continue;
    }

    verdicts.push({
      framework_id: fw.id,
      evidence_level: evidenceLevel,
      quotedReasoning: evidenceLevel === "none" ? "" : quoted,
      explanation,
    });
  }

  // Warn for any usable framework that got no verdict back from the LLM.
  for (const fw of usable) {
    if (!verdicts.find((v) => v.framework_id === fw.id)) {
      console.warn(
        `[semanticFrameworkCheck] No verdict returned by LLM for ${fw.name}(${fw.id}). Treating as not applied.`,
      );
    }
  }

  return verdicts;
}

/**
 * Phase 2 detection. Three tiers, in order:
 *   (a) explicit-keyword (regex, confidence high) — only multi-word keywords
 *       and the framework name/aliases fire here; single-word generic terms
 *       are reserved for the Tier-3 signal-pattern fallback.
 *   (b) semantic LLM check using framework.conceptualDescription and
 *       recognitionSignals, hydrated from the canonical registry when missing.
 *   (c) signal-pattern fallback (confidence low)
 *
 * Frameworks with `accepted_by_professor === false` are excluded entirely.
 */
export async function detectFrameworks(
  studentInput: string,
  signals: SignalExtractionResult,
  frameworks: CaseFramework[],
  language: "es" | "en" = "es",
  _semanticCheckOverride?: typeof semanticFrameworkCheck,
): Promise<FrameworkDetection[]> {
  if (!frameworks || frameworks.length === 0) return [];

  // Filter to engine-eligible frameworks. accepted_by_professor === false
  // (only meaningful for inferred frameworks in Phase 4+) is excluded entirely.
  const eligible = frameworks.filter((fw) => fw.accepted_by_professor !== false);
  // Phase 4 runtime guard: assert no inferred-unaccepted framework slipped
  // into detection. If the filter removed entries, log them so the leak is
  // visible (the filter still protects correctness — this just surfaces it).
  if (eligible.length !== frameworks.length) {
    const rejected = frameworks
      .filter((fw) => fw.accepted_by_professor === false)
      .map((fw) => `${fw.name}(${fw.canonicalId ?? fw.id})`);
    console.warn(
      `[frameworkDetector] Phase4 guard: excluded ${rejected.length} unaccepted suggestion(s) from detection: ${rejected.join(", ")}`,
    );
  }
  if (eligible.length === 0) return [];

  const detections: FrameworkDetection[] = [];
  const needsSemantic: CaseFramework[] = [];

  // Tier 1: explicit keyword/name/alias match.
  // Only multi-word domain keywords qualify as Tier-1 triggers; single-word
  // terms are too generic and would pre-empt the semantic tier.
  for (const fw of eligible) {
    // Multi-word domain keywords only in Tier 1.
    const tier1Keywords = fw.domainKeywords.filter(isTier1Keyword);
    const keywordMatch = tier1Keywords.find((kw) =>
      new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(studentInput),
    );
    // Name match is always Tier 1.
    const nameMatch = new RegExp(`\\b${escapeRegex(fw.name)}\\b`, "i").test(studentInput);
    // Alias match is Tier 1 for multi-word aliases (single-word aliases like
    // "rbv" are distinctive enough but let them through too since they're
    // canonical identifiers, not generic vocabulary).
    const aliasMatch = (fw.aliases || []).find((alias) =>
      new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(studentInput),
    );

    if (nameMatch || keywordMatch || aliasMatch) {
      const matchedTerm = nameMatch ? fw.name : (keywordMatch || aliasMatch || fw.name);
      const snippet = extractSnippet(studentInput, matchedTerm);
      detections.push({
        framework_id: fw.id,
        framework_name: fw.name,
        level: "explicit",
        evidence: language === "en"
          ? `Student wrote: "${snippet}" — directly using "${matchedTerm}", a key term from the ${fw.name} framework.`
          : `El estudiante escribió: "${snippet}" — usando directamente "${matchedTerm}", un término clave del marco ${fw.name}.`,
        confidence: "high",
        detection_method: "keyword",
        reasoning: language === "en"
          ? `Direct keyword match on "${matchedTerm}".`
          : `Coincidencia directa de palabra clave en "${matchedTerm}".`,
        canonicalId: fw.canonicalId || fw.id,
      });
    } else {
      needsSemantic.push(fw);
    }
  }

  // Tier 2: batched semantic check for the remainder.
  // Hydrate rubric from the canonical registry for any framework that is
  // missing conceptualDescription or recognitionSignals.
  let semantic: SemanticVerdict[] = [];
  if (needsSemantic.length > 0) {
    const hydrated = needsSemantic.map((fw) => hydrateFromRegistry(fw, language));
    const checker = _semanticCheckOverride ?? semanticFrameworkCheck;
    semantic = await checker(studentInput, hydrated, language);
  }
  const semanticById = new Map(semantic.map((v) => [v.framework_id, v]));

  const inputLower = studentInput.toLowerCase();

  const globalInputWordCount = studentInput.trim().split(/\s+/).filter(w => w.length > 0).length;

  for (const fw of needsSemantic) {
    const v = semanticById.get(fw.id);
    let semanticFloorRejected = false;

    // TASK 3 §3.5: map evidence_level → {level, confidence}, then apply
    // §T-003B word-count floors AFTER the mapping. Verdicts with
    // evidence_level "none" (whether returned by the LLM or downgraded by
    // the anti-hallucination guard) fall through to Tier 3.
    if (v && v.evidence_level !== "none") {
      const mapped = _mapEvidenceLevelToDetection(v.evidence_level);

      if (globalInputWordCount < 10) {
        console.info(
          `[frameworkDetector] §T-003B floor: rejected ${fw.name} semantic verdict (input too short, word count=${globalInputWordCount}, evidence_level=${v.evidence_level}).`,
        );
        semanticFloorRejected = true;
      } else {
        // Floor B: downgrade medium → low on short (<15-word) inputs.
        // weak_implicit (already low) and explicit (high) are unchanged here.
        let confidence: "high" | "medium" | "low" | undefined = mapped.confidence;
        if (globalInputWordCount < 15 && confidence === "medium") {
          confidence = "low";
          console.info(
            `[frameworkDetector] §T-003B floor: downgraded ${fw.name} to low confidence (input word count=${globalInputWordCount}, evidence_level=${v.evidence_level}).`,
          );
        }

        const detectionLevel = mapped.level === "not_evidenced" ? "implicit" : mapped.level;
        detections.push({
          framework_id: fw.id,
          framework_name: fw.name,
          level: detectionLevel,
          evidence: language === "en"
            ? `Student wrote: "${v.quotedReasoning}" — ${detectionLevel === "explicit" ? `using ${fw.name} terminology directly` : `applying ${fw.name} conceptually without naming it`}.`
            : `El estudiante escribió: "${v.quotedReasoning}" — ${detectionLevel === "explicit" ? `usando terminología del marco ${fw.name} directamente` : `aplicando ${fw.name} conceptualmente sin nombrarlo`}.`,
          confidence: confidence ?? "low",
          detection_method: "semantic",
          reasoning: v.explanation || (language === "en"
            ? `Semantic alignment with ${fw.name} (evidence_level=${v.evidence_level}).`
            : `Alineación semántica con ${fw.name} (evidence_level=${v.evidence_level}).`),
          canonicalId: fw.canonicalId || fw.id,
        });
        continue;
      }
    }

    // Tier 3: signal-pattern fallback (only when semantic didn't fire).
    // Uses all domainKeywords (including single-word) in the keyword check.
    if (fw.signalPattern) {
      const minQ = MIN_QUALITY_MAP[fw.signalPattern.minQuality] ?? 2;
      const signalMap: Record<string, number> = {
        intent: signals.intent.quality,
        justification: signals.justification.quality,
        tradeoffAwareness: signals.tradeoffAwareness.quality,
        stakeholderAwareness: signals.stakeholderAwareness.quality,
        ethicalAwareness: signals.ethicalAwareness.quality,
      };
      const allMet = fw.signalPattern.requiredSignals.every((sig) => (signalMap[sig] ?? 0) >= minQ);
      const additionalKws = fw.signalPattern.additionalKeywords || [];
      const hasAdditional = additionalKws.some((kw) => inputLower.includes(kw.toLowerCase()));
      // In Tier 3, all domainKeywords (including single-word) are fair game.
      if (allMet && (hasAdditional || fw.domainKeywords.some((kw) => inputLower.includes(kw.toLowerCase())))) {
        const sigList = fw.signalPattern.requiredSignals.join(", ");
        detections.push({
          framework_id: fw.id,
          framework_name: fw.name,
          level: "implicit",
          evidence: language === "en"
            ? `Reasoning signals (${sigList}) align with ${fw.name} application patterns in the response.`
            : `Las señales de razonamiento (${sigList}) se alinean con patrones de aplicación del marco ${fw.name} en la respuesta.`,
          confidence: "low",
          detection_method: "signal_pattern",
          reasoning: language === "en"
            ? `Signal-pattern fallback (Tier 3): required signals ${sigList} met at quality ≥ ${fw.signalPattern.minQuality}.`
            : `Fallback de patrón de señales (Tier 3): señales requeridas ${sigList} cumplidas con calidad ≥ ${fw.signalPattern.minQuality}.`,
          canonicalId: fw.canonicalId || fw.id,
        });
        continue;
      }
    }

    detections.push({
      framework_id: fw.id,
      framework_name: fw.name,
      level: "not_evidenced",
      evidence: language === "en"
        ? `No direct or indirect evidence of ${fw.name} application detected in this response.`
        : `No se detectó evidencia directa o indirecta de aplicación del marco ${fw.name} en esta respuesta.`,
      confidence: "low",
      detection_method: "none",
      reasoning: semanticFloorRejected
        ? (language === "en"
          ? `Input too short (fewer than 10 words) to sustain a semantic implicit detection.`
          : `Entrada demasiado corta (menos de 10 palabras) para sostener una detección semántica implícita.`)
        : (language === "en"
          ? `Tier 1 (keyword) and Tier 2 (semantic) returned no match.`
          : `Tier 1 (palabra clave) y Tier 2 (semántico) no devolvieron coincidencias.`),
      canonicalId: fw.canonicalId || fw.id,
    });
  }

  // Preserve original ordering for downstream stability.
  const order = new Map(eligible.map((fw, i) => [fw.id, i]));
  detections.sort((a, b) => (order.get(a.framework_id) ?? 0) - (order.get(b.framework_id) ?? 0));
  return detections;
}

/**
 * Synchronous variant for offline backfill paths that cannot await an LLM
 * (admin /backfill-analysis endpoint). Falls back to keyword + signal-pattern only;
 * the semantic LLM tier does NOT run here.  Uses the same Tier-1 multi-word-keyword
 * tightening and alias matching as the async version.  Registry hydration is not
 * applied because there is no semantic call to feed the rubric into.
 */
export function detectFrameworksSync(
  studentInput: string,
  signals: SignalExtractionResult,
  frameworks: CaseFramework[],
  language: "es" | "en" = "es",
): FrameworkDetection[] {
  if (!frameworks || frameworks.length === 0) return [];
  const eligible = frameworks.filter((fw) => fw.accepted_by_professor !== false);
  const inputLower = studentInput.toLowerCase();

  return eligible.map((fw): FrameworkDetection => {
    // Tier 1: multi-word keywords, name, and aliases.
    const tier1Keywords = fw.domainKeywords.filter(isTier1Keyword);
    const keywordMatch = tier1Keywords.find((kw) =>
      new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(studentInput),
    );
    const nameMatch = new RegExp(`\\b${escapeRegex(fw.name)}\\b`, "i").test(studentInput);
    const aliasMatch = (fw.aliases || []).find((alias) =>
      new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(studentInput),
    );

    if (nameMatch || keywordMatch || aliasMatch) {
      const matchedTerm = nameMatch ? fw.name : (keywordMatch || aliasMatch || fw.name);
      const snippet = extractSnippet(studentInput, matchedTerm);
      return {
        framework_id: fw.id,
        framework_name: fw.name,
        level: "explicit",
        evidence: language === "en"
          ? `Student wrote: "${snippet}" — directly using "${matchedTerm}", a key term from the ${fw.name} framework.`
          : `El estudiante escribió: "${snippet}" — usando directamente "${matchedTerm}", un término clave del marco ${fw.name}.`,
        confidence: "high",
        detection_method: "keyword",
        reasoning: language === "en"
          ? `Direct keyword match on "${matchedTerm}".`
          : `Coincidencia directa de palabra clave en "${matchedTerm}".`,
        canonicalId: fw.canonicalId || fw.id,
      };
    }
    // Tier 3 only (no semantic in sync path): all domainKeywords allowed.
    if (fw.signalPattern) {
      const minQ = MIN_QUALITY_MAP[fw.signalPattern.minQuality] ?? 2;
      const sm: Record<string, number> = {
        intent: signals.intent.quality,
        justification: signals.justification.quality,
        tradeoffAwareness: signals.tradeoffAwareness.quality,
        stakeholderAwareness: signals.stakeholderAwareness.quality,
        ethicalAwareness: signals.ethicalAwareness.quality,
      };
      const allMet = fw.signalPattern.requiredSignals.every((sig) => (sm[sig] ?? 0) >= minQ);
      const addKw = fw.signalPattern.additionalKeywords || [];
      const hasAddKw = addKw.some((kw) => inputLower.includes(kw.toLowerCase()));
      if (allMet && (hasAddKw || fw.domainKeywords.some((kw) => inputLower.includes(kw.toLowerCase())))) {
        const sigList = fw.signalPattern.requiredSignals.join(", ");
        return {
          framework_id: fw.id,
          framework_name: fw.name,
          level: "implicit",
          evidence: language === "en"
            ? `Reasoning signals (${sigList}) align with ${fw.name} application patterns in the response.`
            : `Las señales de razonamiento (${sigList}) se alinean con patrones de aplicación del marco ${fw.name} en la respuesta.`,
          confidence: "low",
          detection_method: "signal_pattern",
          reasoning: language === "en"
            ? `Signal-pattern fallback: required signals ${sigList} met at quality ≥ ${fw.signalPattern.minQuality}.`
            : `Fallback de patrón de señales.`,
          canonicalId: fw.canonicalId || fw.id,
        };
      }
    }
    return {
      framework_id: fw.id,
      framework_name: fw.name,
      level: "not_evidenced",
      evidence: language === "en"
        ? `No direct or indirect evidence of ${fw.name} application detected in this response.`
        : `No se detectó evidencia directa o indirecta de aplicación del marco ${fw.name} en esta respuesta.`,
      confidence: "low",
      detection_method: "none",
      reasoning: language === "en" ? `Sync backfill: no keyword and no signal-pattern match.` : `Backfill sincrónico: sin coincidencia.`,
      canonicalId: fw.canonicalId || fw.id,
    };
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSnippet(text: string, term: string, maxLen: number = 120): string {
  const regex = new RegExp(escapeRegex(term), "i");
  const match = text.match(regex);
  if (!match || match.index === undefined) {
    return text.length > maxLen ? text.substring(0, maxLen).trim() + "..." : text.trim();
  }
  const idx = match.index;
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(text.length, idx + term.length + half);
  if (start > 0) {
    const spaceIdx = text.indexOf(" ", start);
    if (spaceIdx !== -1 && spaceIdx < idx) start = spaceIdx + 1;
  }
  if (end < text.length) {
    const spaceIdx = text.lastIndexOf(" ", end);
    if (spaceIdx !== -1 && spaceIdx > idx + term.length) end = spaceIdx;
  }
  let snippet = text.substring(start, end).trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}
