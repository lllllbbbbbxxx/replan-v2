export type FeedbackStatus = "completed" | "partial" | "not_completed";

export type PartialPercent = 25 | 50 | 75;

export type TaskFeedback =
  | { status: "completed"; percent: 100 }
  | { status: "partial"; percent: PartialPercent }
  | { status: "not_completed"; percent: 0 };

export type FeedbackDraft =
  | TaskFeedback
  | { status: "partial"; percent: null };

export type FeedbackStep = {
  id: string;
  feedback?: TaskFeedback;
};

export function createFeedbackDraft(
  status: FeedbackStatus,
  partialPercent: PartialPercent | null = null,
): FeedbackDraft {
  if (status === "completed") return { status, percent: 100 };
  if (status === "not_completed") return { status, percent: 0 };
  return { status, percent: partialPercent };
}

export function isValidFeedback(
  feedback: FeedbackDraft | TaskFeedback | undefined,
): feedback is TaskFeedback {
  if (!feedback || feedback.percent === null) return false;
  if (feedback.status === "completed") return feedback.percent === 100;
  if (feedback.status === "not_completed") return feedback.percent === 0;
  return [25, 50, 75].includes(feedback.percent);
}

export function submitTaskFeedback<T extends FeedbackStep>(
  steps: T[],
  stepId: string,
  feedback: FeedbackDraft | TaskFeedback,
): T[] {
  if (!isValidFeedback(feedback)) return steps;

  let changed = false;
  const nextSteps = steps.map((step) => {
    if (step.id !== stepId) return step;
    if (
      step.feedback?.status === feedback.status &&
      step.feedback.percent === feedback.percent
    ) {
      return step;
    }

    changed = true;
    return { ...step, feedback: { ...feedback } };
  });

  return changed ? nextSteps : steps;
}

export function feedbackLabel(feedback: TaskFeedback) {
  if (feedback.status === "completed") return "已完成";
  if (feedback.status === "not_completed") return "未完成";
  return `完成 ${feedback.percent}%`;
}
