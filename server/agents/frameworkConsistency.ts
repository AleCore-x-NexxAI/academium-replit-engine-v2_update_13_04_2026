// Phase 2 §12.3 — consistency check between signal extractor and framework detector.
// Promotes not_evidenced → implicit (low confidence, detection_method "consistency_promoted")
// when the framework's primaryDimension signal is PRESENT/STRONG. Never demotes.
//
// Eligibility rule (matches Phase 6 spec):
//   • If pedagogicalIntent.targetFrameworks is present and non-empty, ONLY
//     frameworks whose canonicalId or id appears in that list are eligible.
//   • Otherwise (Phase-2 fallback before pedagogicalIntent exists), frameworks
//     with provenance === "explicit" are eligible.
//
// This prevents promoting a non-target framework just because some signal
// happens to be strong in scenarios where the professor has declared which
// frameworks actually matter.

import type { CaseFramework, FrameworkDetection } from "@shared/schema";
import type { SignalExtractionResult } from "./types";
import { SIGNAL_FOR_DIMENSION } from "./frameworkRegistry";

export interface PedagogicalIntentLite {
  // Phase 3 will add the full type; Phase 2 only needs the eligibility list.
  targetFrameworks?: Array<string | { canonicalId?: string; framework_id?: string }>;
}

export interface PromotionRecord {
  framework_id: string;
  framework_name: string;
  primaryDimension: string;
  signalQuality: number;
  reason: string;
}

function buildEligibleSet(
  frameworks: CaseFramework[],
  pedagogicalIntent?: PedagogicalIntentLite | null,
): Set<string> {
  // pedagogicalIntent.targetFrameworks present → only those are eligible.
  const targets = pedagogicalIntent?.targetFrameworks;
  if (Array.isArray(targets) && targets.length > 0) {
    const targetIds = new Set<string>();
    for (const t of targets) {
      if (typeof t === "string") targetIds.add(t);
      else if (t && typeof t === "object") {
        if (typeof t.canonicalId === "string") targetIds.add(t.canonicalId);
        if (typeof t.framework_id === "string") targetIds.add(t.framework_id);
      }
    }
    const eligible = new Set<string>();
    for (const fw of frameworks) {
      if (targetIds.has(fw.id) || (fw.canonicalId && targetIds.has(fw.canonicalId))) {
        eligible.add(fw.id);
      }
    }
    return eligible;
  }
  // Phase-2 fallback: provenance === "explicit" (default eligible for legacy entries).
  const eligible = new Set<string>();
  for (const fw of frameworks) {
    const provenance = fw.provenance ?? "explicit";
    if (provenance === "explicit") eligible.add(fw.id);
  }
  return eligible;
}

export function checkConsistency(
  signals: SignalExtractionResult,
  detections: FrameworkDetection[],
  frameworks: CaseFramework[],
  pedagogicalIntent?: PedagogicalIntentLite | null,
): { detections: FrameworkDetection[]; promotions: PromotionRecord[] } {
  const promotions: PromotionRecord[] = [];
  const fwById = new Map(frameworks.map((f) => [f.id, f]));
  const eligibleIds = buildEligibleSet(frameworks, pedagogicalIntent);

  const out = detections.map((det) => {
    if (det.level !== "not_evidenced") return det;

    const fw = fwById.get(det.framework_id);
    if (!fw) return det;
    if (!eligibleIds.has(fw.id)) return det;

    if (!fw.primaryDimension) return det;
    const sigKey = SIGNAL_FOR_DIMENSION[fw.primaryDimension];
    const quality = signals[sigKey]?.quality ?? 0;

    // PRESENT (2) or STRONG (3) on the framework's primary dimension.
    if (quality < 2) return det;

    promotions.push({
      framework_id: fw.id,
      framework_name: fw.name,
      primaryDimension: fw.primaryDimension,
      signalQuality: quality,
      reason: `Signal extractor reports ${fw.primaryDimension}=${quality} but detector returned not_evidenced — promoted to implicit (consistency_promoted).`,
    });

    // Promotion replaces the evidence string with the consistency rationale
    // so we don't carry forward a stale "no evidence" justification on what
    // is now an implicit detection.
    const promoted: FrameworkDetection = {
      ...det,
      level: "implicit",
      confidence: "low",
      detection_method: "consistency_promoted",
      evidence: `[consistency] ${fw.primaryDimension} signal at quality ${quality}`,
      reasoning: `Promoted by consistency check: ${fw.primaryDimension} signal at quality ${quality} contradicts not_evidenced verdict.`,
    };
    return promoted;
  });

  return { detections: out, promotions };
}
