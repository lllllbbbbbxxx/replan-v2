import type { TaskFeedback } from "./plan-state";
import { addDays, isIsoDate } from "./planner.ts";
import { calculateRemainingMinutes } from "./remaining-duration.ts";

export type ReplanTask = {
  id: string;
  title: string;
  detail: string;
  estimatedMinutes: number;
  scheduledDate: string;
  feedback?: TaskFeedback;
};

export type FrozenHistoryTask = ReplanTask & {
  feedback: Extract<TaskFeedback, { status: "completed" }>;
};

export type RemainingWorkItem = {
  sourceTaskId: string;
  title: string;
  detail: string;
  fromDate: string;
  originalDuration: number;
  completedDuration: number;
  remainingDuration: number;
};

export type AdjustmentDraftItem = {
  sourceTaskId: string;
  action: "move" | "keep";
  fromDate: string;
  toDate: string;
  remainingDuration: number;
};

export type MinimalReplanDraft = {
  result: "change" | "no_change";
  frozenHistory: FrozenHistoryTask[];
  remainingWork: RemainingWorkItem[];
  adjustments: AdjustmentDraftItem[];
  unchangedFuture: ReplanTask[];
};

function isCompletedTask(task: ReplanTask): task is FrozenHistoryTask {
  return task.feedback?.status === "completed";
}

function validateWindow(today: string, deadline: string) {
  if (!isIsoDate(today) || !isIsoDate(deadline)) {
    throw new Error("日期格式无效。");
  }
  if (deadline < today) {
    throw new Error("截止日期不能早于今天。");
  }
}

export function freezeCompletedTasks(
  tasks: ReplanTask[],
): FrozenHistoryTask[] {
  return tasks.filter(isCompletedTask);
}

export function createRemainingWork(
  tasks: ReplanTask[],
  today: string,
): RemainingWorkItem[] {
  if (!isIsoDate(today)) {
    throw new Error("日期格式无效。");
  }

  return tasks.flatMap((task) => {
    if (
      task.scheduledDate !== today ||
      !task.feedback ||
      task.feedback.status === "completed"
    ) {
      return [];
    }

    const remainingDuration = calculateRemainingMinutes(
      task.estimatedMinutes,
      task.feedback,
    );
    if (remainingDuration === 0) return [];

    return [
      {
        sourceTaskId: task.id,
        title: task.title,
        detail: task.detail,
        fromDate: task.scheduledDate,
        originalDuration: task.estimatedMinutes,
        completedDuration: Math.max(
          0,
          task.estimatedMinutes - remainingDuration,
        ),
        remainingDuration,
      },
    ];
  });
}

export function createMinimalReplanDraft(
  tasks: ReplanTask[],
  today: string,
  deadline: string,
): MinimalReplanDraft {
  validateWindow(today, deadline);

  const frozenHistory = freezeCompletedTasks(tasks);
  const remainingWork = createRemainingWork(tasks, today);
  const nearestFutureDate = today < deadline ? addDays(today, 1) : today;
  const adjustments = remainingWork.map((work) => ({
    sourceTaskId: work.sourceTaskId,
    action: nearestFutureDate === work.fromDate ? "keep" : "move",
    fromDate: work.fromDate,
    toDate: nearestFutureDate,
    remainingDuration: work.remainingDuration,
  })) satisfies AdjustmentDraftItem[];

  return {
    result: adjustments.length > 0 ? "change" : "no_change",
    frozenHistory,
    remainingWork,
    adjustments,
    unchangedFuture: tasks.filter(
      (task) => task.scheduledDate > today && !isCompletedTask(task),
    ),
  };
}
