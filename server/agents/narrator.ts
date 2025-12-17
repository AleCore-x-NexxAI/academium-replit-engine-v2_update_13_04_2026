import { generateChatCompletion } from "../openai";
import type { AgentContext, NarratorOutput, DomainExpertOutput, EvaluatorOutput } from "./types";
import { NPC_PERSONAS } from "./types";

const NARRATOR_SYSTEM_PROMPT = `You are the MASTER STORYTELLER for SIMULEARN, an elite business simulation engine used by top business schools.

YOUR MISSION: Create breathtakingly immersive, cinematic narrative responses that make every decision feel consequential and real. You are Steven Spielberg directing a business thriller.

CRITICAL RULES:
1. NEVER break character or ask for clarification - ALWAYS advance the story
2. EMBRACE unconventional decisions - they create the most dramatic stories
3. Show CONSEQUENCES vividly - both good and bad decisions lead to interesting outcomes
4. Use SENSORY details - describe what people see, hear, feel in the room
5. Create TENSION and STAKES - every moment matters
6. Make NPCs come ALIVE with distinct voices and reactions

NARRATIVE TECHNIQUES:
- Open with action or reaction, not summary
- Use present tense for immediacy ("The room goes silent...")
- Include body language, facial expressions, environmental details
- NPCs should have emotional reactions that feel authentic
- End with a new challenge or decision point to maintain momentum
- Balance showing consequences with presenting new opportunities

HANDLING UNCONVENTIONAL/RISKY DECISIONS:
When students make bold, unusual, or ethically questionable choices:
- NEVER lecture or moralize in the narrative
- Show realistic CONSEQUENCES through story
- Let NPCs react authentically (shock, concern, enthusiasm)
- Create interesting situations that explore the implications
- The story should be educational through experience, not preaching

For example, if a student says "push everyone to work 80-hour weeks":
- Don't say "That's unethical" 
- Instead, show exhausted faces, resignation letters appearing, productivity spikes followed by mistakes, etc.

AVAILABLE NPCs (use them to create dynamic scenes):
${Object.entries(NPC_PERSONAS)
  .map(([name, npc]) => `${npc.name} (${npc.role}): ${npc.trait}. Style: ${npc.prompt}`)
  .join("\n")}

MOOD MAPPING:
- positive: Progress, wins, momentum, hope
- negative: Setbacks, friction, warning signs
- crisis: Breaking point, ultimatums, critical decisions
- neutral: Information gathering, planning, steady state

OUTPUT FORMAT (strict JSON only, no markdown):
{
  "text": "<100-150 word immersive narrative with sensory details and NPC dialogue>",
  "speaker": "<primary NPC name if dialogue-heavy, or null>",
  "mood": "positive" | "negative" | "crisis" | "neutral",
  "suggestedOptions": ["<specific option 1>", "<contrasting option 2>", "<bold option 3>"]
}

Keep narratives punchy and impactful. Quality over quantity.`;

export async function generateNarrative(
  context: AgentContext,
  kpiImpact: DomainExpertOutput,
  evaluation: EvaluatorOutput
): Promise<NarratorOutput> {
  const selectNPC = (): string | null => {
    const input = context.studentInput.toLowerCase();
    const flags = evaluation.flags.join(" ").toLowerCase();
    const kpiDeltas = kpiImpact.kpiDeltas;

    if (kpiDeltas.morale && kpiDeltas.morale <= -10) return "Sarah";
    if (kpiDeltas.revenue && Math.abs(kpiDeltas.revenue) >= 10000) return "Marcus";
    if (flags.includes("ethical") || flags.includes("questionable") || flags.includes("risky")) return "Alex";
    if (kpiDeltas.efficiency && kpiDeltas.efficiency >= 5) return "Victor";
    
    if (input.includes("cost") || input.includes("budget") || input.includes("money") || input.includes("spend")) {
      return "Marcus";
    }
    if (input.includes("team") || input.includes("employee") || input.includes("people") || input.includes("work") || input.includes("overtime")) {
      return "Sarah";
    }
    if (input.includes("deadline") || input.includes("launch") || input.includes("deliver") || input.includes("push") || input.includes("faster")) {
      return "Victor";
    }
    if (input.includes("right") || input.includes("wrong") || input.includes("honest") || input.includes("lie") || input.includes("ethical")) {
      return "Alex";
    }
    
    const randomNPCs = ["Marcus", "Sarah", "Victor", "Alex"];
    return randomNPCs[Math.floor(Math.random() * randomNPCs.length)];
  };

  const selectedNpc = selectNPC();
  const npcContext = selectedNpc ? NPC_PERSONAS[selectedNpc as keyof typeof NPC_PERSONAS] : null;

  const kpiSummary = Object.entries(kpiImpact.kpiDeltas)
    .filter(([_, v]) => v !== 0)
    .map(([k, v]) => {
      const direction = v > 0 ? "increased" : "decreased";
      const intensity = Math.abs(v) >= 10 ? "significantly" : "slightly";
      return `${k} ${intensity} ${direction}`;
    })
    .join(", ");

  // Build rich context from enhanced scenario data
  const scenarioContext = [];
  if (context.scenario.companyName) scenarioContext.push(`Company: ${context.scenario.companyName}`);
  if (context.scenario.industry) scenarioContext.push(`Industry: ${context.scenario.industry}`);
  if (context.scenario.companySize) scenarioContext.push(`Company Size: ${context.scenario.companySize}`);
  if (context.scenario.timelineContext) scenarioContext.push(`Timeline: ${context.scenario.timelineContext}`);
  
  const environmentContext = [];
  if (context.scenario.industryContext) environmentContext.push(`Industry Dynamics: ${context.scenario.industryContext}`);
  if (context.scenario.competitiveEnvironment) environmentContext.push(`Competitive Landscape: ${context.scenario.competitiveEnvironment}`);
  if (context.scenario.regulatoryEnvironment) environmentContext.push(`Regulations: ${context.scenario.regulatoryEnvironment}`);
  if (context.scenario.culturalContext) environmentContext.push(`Cultural Factors: ${context.scenario.culturalContext}`);
  if (context.scenario.resourceConstraints) environmentContext.push(`Resources: ${context.scenario.resourceConstraints}`);
  
  const stakeholderInfo = context.scenario.stakeholders?.length 
    ? `KEY STAKEHOLDERS:\n${context.scenario.stakeholders.map(s => `- ${s.name} (${s.role}): ${s.interests} [${s.influence} influence]`).join("\n")}`
    : "";
    
  const constraintsInfo = context.scenario.keyConstraints?.length
    ? `CONSTRAINTS: ${context.scenario.keyConstraints.join("; ")}`
    : "";
    
  const ethicsInfo = context.scenario.ethicalDimensions?.length
    ? `ETHICAL CONSIDERATIONS: ${context.scenario.ethicalDimensions.join("; ")}`
    : "";

  const userPrompt = `
SCENARIO: "${context.scenario.title}"
DOMAIN: ${context.scenario.domain}
${scenarioContext.length > 0 ? scenarioContext.join(" | ") : ""}
STUDENT ROLE: ${context.scenario.role}
OBJECTIVE: ${context.scenario.objective}
DIFFICULTY: ${context.scenario.difficultyLevel || "intermediate"}
TURN NUMBER: ${context.turnCount + 1}

${context.scenario.situationBackground ? `SITUATION BACKGROUND:\n${context.scenario.situationBackground}\n` : ""}
${environmentContext.length > 0 ? `ENVIRONMENT:\n${environmentContext.join("\n")}\n` : ""}
${stakeholderInfo}
${constraintsInfo}
${ethicsInfo}

THE STUDENT'S DECISION: "${context.studentInput}"

CONSEQUENCES HAPPENING:
- KPI Changes: ${kpiSummary || "Subtle shifts in the landscape"}
- Business Logic: ${kpiImpact.reasoning}
- Evaluation Flags: ${evaluation.flags.length ? evaluation.flags.join(", ") : "Standard business decision"}

RECENT HISTORY:
${context.history.slice(-3).map((h) => `[${h.role}${h.speaker ? ` - ${h.speaker}` : ""}]: ${h.content}`).join("\n")}

${stakeholderInfo ? "Use the SCENARIO STAKEHOLDERS above as NPCs if defined. Otherwise use:" : ""}
REQUIRED NPC: ${npcContext ? `Feature ${npcContext.name} (${npcContext.role}) prominently. Their personality: ${npcContext.trait}. Their style: ${npcContext.prompt}` : "Choose the most relevant NPC for this situation."}

WRITE: A vivid scene (100-150 words) showing the immediate aftermath. Reference specific stakeholders, constraints, and environment details to make it feel authentic and tailored. Include NPC reactions and end with a new challenge.`;

  try {
    const response = await generateChatCompletion(
      [
        { role: "system", content: NARRATOR_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json", maxTokens: 800 }
    );

    const parsed = JSON.parse(response);
    
    const text = parsed.text || "The weight of your decision hangs in the air. Eyes turn to you, waiting for what comes next. The situation continues to evolve, and your next move will shape everything that follows.";
    const suggestedOptions = parsed.suggestedOptions?.length 
      ? parsed.suggestedOptions 
      : [
          "Take a moment to assess the situation carefully",
          "Address the most pressing concern head-on",
          "Make a bold, unexpected move"
        ];

    return {
      text,
      speaker: parsed.speaker || npcContext?.name || undefined,
      mood: parsed.mood || "neutral",
      suggestedOptions,
    };
  } catch (error) {
    console.error("Narrator agent error:", error);
    
    const fallbackNpc = npcContext?.name || "Sarah";
    return {
      text: `${fallbackNpc} pauses, taking in the implications of your decision. The room seems to hold its breath. "Interesting approach," ${fallbackNpc === "Victor" ? "he" : "she"} says carefully. "Let's see where this leads us." The team exchanges glances - some worried, some curious. Your move has set something in motion. What will you do to capitalize on this moment?`,
      speaker: fallbackNpc,
      mood: "neutral",
      suggestedOptions: [
        "Follow up with clear direction to the team",
        "Gather more information before proceeding",
        "Double down on your approach with confidence",
      ],
    };
  }
}
