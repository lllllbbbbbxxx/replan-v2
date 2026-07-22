import type { TaskFeedback } from "./plan-state";

export const REMAINING_ROUNDING_MINUTES = 30;

export type RemainingDurationFeedback =
  | TaskFeedback
  | { status: "not_started"; percent?: 0 };

export type TimedStep = {
  estimatedMinutes: number;
  feedback?: RemainingDurationFeedback;
};

function safeOriginalMinutes(estimatedMinutes: number) {
  if (!Number.isFinite(estimatedMinutes)) return 0;
  return Math.max(0, estimatedMinutes);
}

function completedPercent(feedback?: RemainingDurationFeedback) {
  if (!feedback) return 0;
  if (feedback.status === "completed") return 100;
  if (
    feedback.status === "not_completed" ||
    feedback.status === "not_started"
  ) {
    return 0;
  }

  return Math.min(100, Math.max(0, feedback.percent));
}

export function calculateRemainingMinutes(
  estimatedMinutes: number,
  feedback?: RemainingDurationFeedback,
) {
  const originalMinutes = safeOriginalMinutes(estimatedMinutes);
  if (originalMinutes === 0) return 0;

  const rawRemaining = Math.max(
    0,
    originalMinutes * (1 - completedPercent(feedback) / 100),
  );
  if (rawRemaining === 0) return 0;

  return Math.max(
    REMAINING_ROUNDING_MINUTES,
    Math.ceil(rawRemaining / REMAINING_ROUNDING_MINUTES) *
      REMAINING_ROUNDING_MINUTES,
  );
}

export function calculateTotalRemainingMinutes(steps: TimedStep[]) {
  return steps.reduce(
    (total, step) =>
      total + calculateRemainingMinutes(step.estimatedMinutes, step.feedback),
    0,
  );
}

export function calculateTotalOriginalMinutes(steps: TimedStep[]) {
  return steps.reduce(
    (total, step) => total + safeOriginalMinutes(step.estimatedMinutes),
    0,
  );
}
