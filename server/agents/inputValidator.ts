/**
 * Input Validation Agent
 * 
 * VERY LENIENT VALIDATION - Only block on truly problematic input
 * 
 * This agent validates student/user input BEFORE any main simulation processing.
 * 
 * BLOCKING RULES (only these block the student):
 * 1. Profanity/unsafe content
 * 2. Empty input
 * 3. Clear nonsense/spam (random characters, keyboard mashing)
 * 4. Completely off-topic responses with zero case connection
 * 
 * ACCEPTANCE RULES:
 * - Any response with ANY connection to the case: ACCEPT
 * - Short but relevant responses: ACCEPT
 * - Brief justifications: ACCEPT
 * - When in doubt: ALWAYS ACCEPT
 * 
 * No "needsElaboration" category — either accept or reject, nothing in between.
 */

import { generateChatCompletion, SupportedModel } from "../openai";

export interface InputValidationResult {
  isValid: boolean;
  rejectionReason?: string;
  userMessage?: string;
}

const OFFENSIVE_PATTERNS = [
  /\b(mierda|puta|puto|cabrón|cabron|hijo\s*de\s*puta|verga|chingar|pinche|culero|joto|marica|maricón|maricon|zorra)\b/i,
  /\b(fuck|fucking|bitch|bastard|dick|cock|pussy|cunt|retard)\b/i,
  /\b(kill\s*(yourself|urself)|kys|die|hate\s*you)\b/i,
];

const NONSENSE_PATTERNS = [
  /^[a-z]{1,2}$/i,
  /^(asdf|qwer|zxcv|hjkl)+$/i,
  /^[^a-záéíóúñü\s]{10,}$/i,
  /^(.)\1{6,}$/i,
  /^[0-9\s\W]+$/i,
];

const MIN_INPUT_LENGTH = 3;

type Language = "es" | "en";

const REJECTION_MESSAGES: Record<Language, Record<string, string>> = {
  es: {
    REJECTION_EMPTY: "Tu respuesta está vacía.",
    REJECTION_PROFANITY: "Tu respuesta contiene lenguaje que no podemos procesar.",
    REJECTION_NONSENSE: "Tu respuesta no parece relacionada con el caso.",
    DEFAULT: "Para continuar, necesito que conectes tu respuesta con el caso y expliques tu prioridad.",
  },
  en: {
    REJECTION_EMPTY: "Your response is empty.",
    REJECTION_PROFANITY: "Your response contains language we cannot process.",
    REJECTION_NONSENSE: "Your response does not seem related to the case.",
    DEFAULT: "To continue, please connect your response to the case and explain your priority.",
  },
};

function quickValidation(input: string): string | null {
  const trimmed = input.trim();
  
  if (trimmed.length < MIN_INPUT_LENGTH) {
    return "REJECTION_EMPTY";
  }
  
  for (const pattern of OFFENSIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "REJECTION_PROFANITY";
    }
  }
  
  for (const pattern of NONSENSE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "REJECTION_NONSENSE";
    }
  }
  
  return null;
}

function getSystemPrompt(language: Language): string {
  if (language === "en") {
    return `You are a VERY PERMISSIVE validator for an educational business simulation.

Your goal: verify that the student is responding about the case — you do NOT judge quality, depth, or structure.

ACCEPT if the response has ANY connection to the case:
- Mentions something related to the topic, company, characters, or situation of the case
- Proposes some action, decision, or direction (even if brief)
- Expresses an opinion or stance on the problem
- Short but relevant responses: "I prioritize quality", "Reduce costs", "I focus on the team" → ACCEPT
- Long responses that touch on the topic even if they ramble → ACCEPT

REJECT ONLY if the response has NO relation to the case:
- Meaningless text, random characters, or spam
- Offensive or inappropriate content
- Empty or 1-2 generic word responses: "yes", "no", "ok", "I don't know"
- Completely off-topic responses about something totally different from the case
- Generic responses that mention NOTHING about the case: "We need to make good decisions", "It's important to analyze"

WHEN IN DOUBT: ALWAYS ACCEPT. Prefer to accept 10 mediocre responses rather than reject 1 valid one.

Respond in JSON:
{
  "isValid": true/false,
  "reason": "brief explanation"
}`;
  }

  return `Eres un validador MUY PERMISIVO para una simulación educativa de negocios.

Tu objetivo: verificar que el estudiante está respondiendo sobre el caso — NO juzgas calidad, profundidad ni estructura.

ACEPTA si la respuesta tiene CUALQUIER conexión con el caso:
- Menciona algo relacionado con el tema, la empresa, los personajes o la situación del caso
- Propone alguna acción, decisión o dirección (aunque sea breve)
- Expresa una opinión o postura sobre el problema
- Respuestas cortas pero relevantes: "Priorizo la calidad", "Reducir costos", "Me enfoco en el equipo" → ACEPTA
- Respuestas largas que tocan el tema aunque divaguen → ACEPTA

RECHAZA SOLO si la respuesta NO tiene NINGUNA relación con el caso:
- Texto sin sentido, caracteres aleatorios o spam
- Contenido ofensivo o inapropiado
- Respuestas vacías o de 1-2 palabras genéricas: "sí", "no", "ok", "no sé"
- Respuestas completamente fuera de tema que hablan de algo totalmente diferente al caso (ej: si el caso es sobre marketing y el estudiante habla de lanzar cohetes al espacio)
- Respuestas genéricas que NO mencionan nada del caso: "Hay que tomar buenas decisiones", "Es importante analizar"

EN CASO DE DUDA: SIEMPRE ACEPTA. Prefiere aceptar 10 respuestas mediocres antes que rechazar 1 respuesta válida.

Responde en JSON:
{
  "isValid": true/false,
  "reason": "breve explicación"
}`;
}

function getUserPrompt(input: string, caseContext: { title: string; objective: string; recentHistory?: string }, language: Language): string {
  if (language === "en") {
    return `CASE: ${caseContext.title}
OBJECTIVE: ${caseContext.objective}
${caseContext.recentHistory ? `RECENT CONTEXT:\n${caseContext.recentHistory}` : ""}

STUDENT RESPONSE:
"${input}"

Does the response show reasoning connected to the case? Respond in JSON.`;
  }

  return `CASO: ${caseContext.title}
OBJETIVO: ${caseContext.objective}
${caseContext.recentHistory ? `CONTEXTO RECIENTE:\n${caseContext.recentHistory}` : ""}

RESPUESTA DEL ESTUDIANTE:
"${input}"

¿La respuesta muestra razonamiento conectado al caso? Responde en JSON.`;
}

async function llmValidation(
  input: string,
  caseContext: { title: string; objective: string; recentHistory?: string },
  language: Language,
  model?: SupportedModel
): Promise<InputValidationResult> {
  const messages = REJECTION_MESSAGES[language];

  try {
    const response = await generateChatCompletion(
      [
        { role: "system", content: getSystemPrompt(language) },
        { role: "user", content: getUserPrompt(input, caseContext, language) }
      ],
      { 
        responseFormat: "json",
        model: model || "gpt-4o-mini",
        agentName: "inputValidator"
      }
    );

    const result = JSON.parse(response);
    
    if (!result.isValid) {
      return {
        isValid: false,
        rejectionReason: result.reason,
        userMessage: messages.DEFAULT
      };
    }
    
    return { isValid: true };
    
  } catch (error) {
    console.error("[InputValidator] LLM validation error:", error);
    return { isValid: true };
  }
}

function getS6BRejectionReason(type: string, language: Language): string {
  const messages = REJECTION_MESSAGES[language];
  return messages[type] || messages.DEFAULT;
}

export async function validateSimulationInput(
  input: string,
  caseContext: { 
    title: string; 
    objective: string; 
    recentHistory?: string;
  },
  options?: { 
    skipLlmValidation?: boolean; 
    model?: SupportedModel;
    language?: Language;
  }
): Promise<InputValidationResult> {
  const language: Language = options?.language || "es";
  
  const quickResult = quickValidation(input);
  if (quickResult) {
    console.log("[InputValidator] Quick validation failed:", quickResult);
    return {
      isValid: false,
      rejectionReason: quickResult,
      userMessage: getS6BRejectionReason(quickResult, language)
    };
  }
  
  if (!options?.skipLlmValidation) {
    const llmResult = await llmValidation(input, caseContext, language, options?.model);
    if (!llmResult.isValid) {
      console.log("[InputValidator] LLM validation failed:", llmResult.rejectionReason);
      return {
        ...llmResult,
        userMessage: REJECTION_MESSAGES[language].DEFAULT
      };
    }
  }
  
  return { isValid: true };
}
