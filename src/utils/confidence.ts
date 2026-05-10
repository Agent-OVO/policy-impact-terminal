import type { ConfidenceScore, Percent } from "../types";

export type ConfidenceBand = "high" | "medium" | "low" | "unknown";

export function clampScore(value: number | null | undefined, fallback = 0): ConfidenceScore {
  const score = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function clampPercent(value: number | null | undefined, fallback = 0): Percent {
  return clampScore(value, fallback);
}

export function getConfidenceBand(score: number | null | undefined): ConfidenceBand {
  const normalized = clampScore(score);

  if (normalized >= 80) return "high";
  if (normalized >= 60) return "medium";
  if (normalized > 0) return "low";

  return "unknown";
}

export function averageConfidence(scores: Array<number | null | undefined>): ConfidenceScore {
  const validScores = scores.filter((score): score is number => (
    typeof score === "number" && Number.isFinite(score)
  ));

  if (validScores.length === 0) return 0;

  const total = validScores.reduce((sum, score) => sum + score, 0);
  return clampScore(total / validScores.length);
}
