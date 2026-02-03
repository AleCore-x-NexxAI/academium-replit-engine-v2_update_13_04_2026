/**
 * Input Validation Agent
 * 
 * POC S4.1: LENIENT VALIDATION - Only block on truly problematic input
 * 
 * This agent validates student/user input BEFORE any main simulation processing.
 * 
 * BLOCKING RULES (only these block the student):
 * 1. Profanity/unsafe content
 * 2. Empty input
 * 3. Clear nonsense/spam (random characters, keyboard mashing)
 * 
 * ACCEPTANCE RULES:
 * - Short but relevant responses: ACCEPT
 * - Brief justifications: ACCEPT
 * - Any attempt at engagement with the case: ACCEPT
 * 
 * POC Priority: Smooth completion + authentic reasoning > quota-writing
 */

import { generateChatCompletion, SupportedModel } from "../openai";

export interface InputValidationResult {
  isValid: boolean;
  rejectionReason?: string;
  userMessage?: string; // Message to show the user if rejected
}

// List of offensive words/patterns - ONLY block on truly offensive content
const OFFENSIVE_PATTERNS = [
  // Spanish insults (severe only)
  /\b(mierda|puta|puto|cabrón|cabron|hijo\s*de\s*puta|verga|chingar|pinche|culero|joto|marica|maricón|maricon|zorra)\b/i,
  // English insults (severe only)
  /\b(fuck|fucking|bitch|bastard|dick|cock|pussy|cunt|retard)\b/i,
  // General offensive patterns
  /\b(kill\s*(yourself|urself)|kys|die|hate\s*you)\b/i,
];

// Patterns that indicate clear nonsense/gibberish - only the most obvious
const NONSENSE_PATTERNS = [
  /^[a-z]{1,2}$/i, // 1-2 random letters only
  /^(asdf|qwer|zxcv|hjkl)+$/i, // Pure keyboard mashing
  /^[^a-záéíóúñü\s]{10,}$/i, // Long strings with no letters at all
  /^(.)\1{6,}$/i, // Same character repeated 7+ times
  /^[0-9\s\W]+$/i, // Only numbers and symbols (no letters at all)
];

// POC: Very lenient minimum - just needs SOMETHING
const MIN_INPUT_LENGTH = 3;

/**
 * POC S4.1: Quick validation - LENIENT
 * Only blocks on: empty, profanity, or clear nonsense
 * Returns null if validation passes, error message if fails
 */
function quickValidation(input: string): string | null {
  const trimmed = input.trim();
  
  // Block 1: Empty input only
  if (trimmed.length < MIN_INPUT_LENGTH) {
    return "Por favor, escribe una respuesta.";
  }
  
  // Block 2: Offensive patterns (profanity/unsafe)
  for (const pattern of OFFENSIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "Tu respuesta contiene lenguaje inapropiado. Por favor, reformula tu respuesta con un tono profesional.";
    }
  }
  
  // Block 3: Clear nonsense/spam only
  for (const pattern of NONSENSE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "Tu respuesta parece no estar relacionada con el caso. Por favor, inténtalo de nuevo.";
    }
  }
  
  return null; // Passed - accept everything else
}

/**
 * POC S4.1: LLM validation - VERY LENIENT
 * Only blocks on truly unacceptable content
 * Default: ACCEPT unless clearly problematic
 */
async function llmValidation(
  input: string,
  caseContext: { title: string; objective: string; recentHistory?: string },
  model?: SupportedModel
): Promise<InputValidationResult> {
  const systemPrompt = `Eres un validador MUY PERMISIVO para una simulación educativa.

REGLA PRINCIPAL: ACEPTA casi todo. Solo rechaza en casos extremos.

RECHAZA ÚNICAMENTE si la respuesta es:
1. Contenido ofensivo, insultos o groserías graves
2. Texto completamente aleatorio sin ningún sentido (ej: "asdfghjkl", "123456")
3. Intento claro de romper el sistema o spam

ACEPTA TODO LO DEMÁS, incluyendo:
- Respuestas cortas pero que mencionan algo del caso
- Respuestas breves como "Opción A porque es más seguro"
- Cualquier intento de engagement con la simulación
- Respuestas incompletas o parciales
- "No sé pero creo que..." - esto es válido
- Justificaciones simples de 1-2 frases

PRIORIDAD: Fluidez de la experiencia > Profundidad perfecta

Responde en JSON:
{
  "isValid": true/false,
  "reason": "breve explicación"
}`;

  const userPrompt = `CASO: ${caseContext.title}

RESPUESTA A VALIDAR:
"${input}"

¿Es aceptable? (Recuerda: sé MUY permisivo, solo rechaza casos extremos)`;

  try {
    const response = await generateChatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      { 
        responseFormat: "json",
        model: model || "gpt-4o-mini"
      }
    );

    const result = JSON.parse(response);
    
    if (!result.isValid) {
      return {
        isValid: false,
        rejectionReason: result.reason,
        userMessage: "Tu respuesta no pudo procesarse. Por favor, inténtalo de nuevo."
      };
    }
    
    return { isValid: true };
    
  } catch (error) {
    console.error("[InputValidator] LLM validation error:", error);
    // On error, ALWAYS accept
    return { isValid: true };
  }
}

/**
 * Main validation function - validates user input before simulation processing
 * 
 * @param input - The user's input text
 * @param caseContext - Context about the current case/scenario
 * @param options - Configuration options
 * @returns Validation result indicating if input is valid
 */
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
  }
): Promise<InputValidationResult> {
  
  // Step 1: Quick regex-based validation (catches obvious issues fast)
  const quickResult = quickValidation(input);
  if (quickResult) {
    console.log("[InputValidator] Quick validation failed:", quickResult);
    return {
      isValid: false,
      rejectionReason: "Quick validation failed",
      userMessage: quickResult
    };
  }
  
  // Step 2: LLM-based validation for nuanced checks (unless skipped)
  if (!options?.skipLlmValidation) {
    const llmResult = await llmValidation(input, caseContext, options?.model);
    if (!llmResult.isValid) {
      console.log("[InputValidator] LLM validation failed:", llmResult.rejectionReason);
      return llmResult;
    }
  }
  
  return { isValid: true };
}
