import {
  isValidFeedback,
  submitTaskFeedback,
  type TaskFeedback,
} from "./plan-state.ts";
import { createGuardedReplanDraft } from "./replan-guard.ts";
import type { ReplanTask } from "./replan.ts";

export type RemovedPreviewItem = {
  sourceTaskId: string;
  title: string;
  date: string;
};

export type ShortenedPreviewItem = {
  sourceTaskId: string;
  title: string;
  originalDuration: number;
  remainingDuration: number;
};

export type MovedPreviewItem = {
  sourceTaskId: string;
  title: string;
  fromDate: string;
  toDate: string;
  remainingDuration: number;
};

export type UnchangedPreviewItem = {
  sourceTaskId: string;
  title: string;
  date: string;
  duration: number;
};

export type ReplanPreview = {
  feedbackTaskId: string;
  proposedFeedback: TaskFeedback;
  changes: {
    removed: RemovedPreviewItem[];
    shortened: ShortenedPreviewItem[];
    moved: MovedPreviewItem[];
    unchanged: UnchangedPreviewItem[];
  };
  baseSignature: string;
  basePlanVersion: number;
  nextSteps: ReplanTask[];
};

function cloneTask(task: ReplanTask): ReplanTask {
  return task.feedback
    ? { ...task, feedback: { ...task.feedback } }
    : { ...task };
}

function planSignature(tasks: ReplanTask[]) {
  return JSON.stringify(tasks);
}

export function normalizePlanVersion(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : 1;
}

export function createReplanPreview(
  tasks: ReplanTask[],
  stepId: string,
  feedback: TaskFeedback,
  today: string,
  deadline: string,
  planVersion = 1,
): ReplanPreview {
  if (!isValidFeedback(feedback)) {
    throw new Error("反馈状态无效。");
  }

  const target = tasks.find((task) => task.id === stepId);
  if (!target) {
    throw new Error("找不到要反馈的任务。");
  }

  const feedbackSteps = submitTaskFeedback(tasks, stepId, feedback);
  const { draft, integrity } = createGuardedReplanDraft(
    feedbackSteps,
    today,
    deadline,
  );

  if (integrity.status === "invalid") {
    throw new Error(integrity.issues[0]?.message ?? "无法生成安全的调整预览。");
  }

  const remainingBySource = new Map(
    draft.remainingWork.map((item) => [item.sourceTaskId, item]),
  );
  const adjustmentsBySource = new Map(
    integrity.adjustments.map((item) => [item.sourceTaskId, item]),
  );
  const nextSteps = feedbackSteps.map((task) => {
    const adjustment = adjustmentsBySource.get(task.id);
    return adjustment
      ? { ...task, scheduledDate: adjustment.toDate }
      : task;
  });

  const removed =
    feedback.status === "completed"
      ? [
          {
            sourceTaskId: target.id,
            title: target.title,
            date: target.scheduledDate,
          },
        ]
      : [];
  const shortened = draft.remainingWork
    .filter((item) => item.remainingDuration < item.originalDuration)
    .map((item) => ({
      sourceTaskId: item.sourceTaskId,
      title: item.title,
      originalDuration: item.originalDuration,
      remainingDuration: item.remainingDuration,
    }));
  const moved = integrity.adjustments
    .filter((item) => item.fromDate !== item.toDate)
    .map((item) => {
      const work = remainingBySource.get(item.sourceTaskId);
      return {
        sourceTaskId: item.sourceTaskId,
        title: work?.title ?? item.sourceTaskId,
        fromDate: item.fromDate,
        toDate: item.toDate,
        remainingDuration: item.remainingDuration,
      };
    });
  const unchanged = draft.unchangedFuture.map((task) => ({
    sourceTaskId: task.id,
    title: task.title,
    date: task.scheduledDate,
    duration: task.estimatedMinutes,
  }));

  return {
    feedbackTaskId: stepId,
    proposedFeedback: { ...feedback },
    changes: { removed, shortened, moved, unchanged },
    baseSignature: planSignature(tasks),
    basePlanVersion: normalizePlanVersion(planVersion),
    nextSteps: nextSteps.map(cloneTask),
  };
}

export function confirmReplanPreview(
  currentSteps: ReplanTask[],
  preview: ReplanPreview,
): ReplanTask[] {
  if (planSignature(currentSteps) !== preview.baseSignature) {
    throw new Error("原计划已发生变化，请重新生成调整预览。");
  }

  return preview.nextSteps.map(cloneTask);
}

export function cancelReplanPreview<T extends ReplanTask>(steps: T[]): T[] {
  return steps;
}

export function confirmVersionedReplanPreview<
  T extends { planVersion: number; steps: ReplanTask[] },
>(plan: T, preview: ReplanPreview): T {
  if (plan.planVersion !== preview.basePlanVersion) {
    throw new Error("计划版本已发生变化，请重新生成调整预览。");
  }

  const nextSteps = confirmReplanPreview(plan.steps, preview);
  return {
    ...plan,
    planVersion: plan.planVersion + 1,
    steps: nextSteps,
  };
}
