export interface DetectionInput {
  framework_id: string;
  level: "explicit" | "implicit" | "not_evidenced";
  confidence?: "high" | "medium" | "low";
  detection_method?: string;
  evidence?: string;
}

/**
 * §T-003B: returns the weighted contribution of a single session toward a
 * framework's Module Health score.
 *
 * Rule: find the highest-scoring detection for the framework in the session.
 * signal_pattern and consistency_promoted never contribute regardless of
 * level/confidence. Returns 1.0 for explicit or implicit-high, 0.5 for
 * implicit-medium, 0.0 otherwise.
 */
export function sessionWeightedScore(
  frameworkId: string,
  framework_detections: DetectionInput[][],
): number {
  let sessionScore = 0;
  for (const turnDets of framework_detections) {
    const det = turnDets?.find((d) => d.framework_id === frameworkId);
    if (!det) continue;
    const dm = det.detection_method || "keyword";
    if (dm === "signal_pattern" || dm === "consistency_promoted") continue;
    if (det.level === "explicit" || (det.level === "implicit" && det.confidence === "high")) {
      sessionScore = Math.max(sessionScore, 1.0);
    } else if (det.level === "implicit" && det.confidence === "medium") {
      sessionScore = Math.max(sessionScore, 0.5);
    }
  }
  return sessionScore;
}

/**
 * §T-003B: applies the Applied-Course-Theory rule to a single session.
 * Returns true iff ANY detection for ANY eligible framework in the session
 * is explicit OR (implicit AND confidence in {medium, high}) AND the
 * detection_method is not signal_pattern or consistency_promoted.
 */
export function sessionAppliedCourseTheory(
  eligibleFrameworkIds: Set<string>,
  framework_detections: DetectionInput[][],
): boolean {
  return framework_detections.some((turnDetections) =>
    turnDetections?.some((d) => {
      if (!eligibleFrameworkIds.has(d.framework_id)) return false;
      const dm = d.detection_method || "keyword";
      if (dm === "signal_pattern" || dm === "consistency_promoted") return false;
      return (
        d.level === "explicit" ||
        (d.level === "implicit" && (d.confidence === "medium" || d.confidence === "high"))
      );
    }),
  );
}

/**
 * §T-003B: maps a session's raw extracted_text signal to whether it should
 * render in the reasoning-signals tab. Returns true iff the text is
 * substantive (not empty, not a known placeholder, more than 3 chars after
 * trimming).
 */
export function isSubstantiveExtractedText(text: string): boolean {
  const txt = (text ?? "").trim();
  if (txt.length === 0) return false;
  const lower = txt.toLowerCase();
  if (lower === "no specific evidence extracted." || lower === "no se extrajo evidencia específica.") return false;
  if (txt.length <= 3) return false;
  return true;
}
