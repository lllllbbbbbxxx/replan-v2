import { isIsoDate } from "./planner.ts";
import {
  createMinimalReplanDraft,
  type AdjustmentDraftItem,
  type MinimalReplanDraft,
  type ReplanTask,
} from "./replan.ts";

export type ReplanIntegrityIssueCode =
  | "active_task_duplicated"
  | "completed_task_reintroduced"
  | "date_out_of_bounds"
  | "duplicate_adjustment"
  | "duplicate_remaining_work"
  | "duration_mismatch"
  | "missing_adjustment"
  | "unexpected_adjustment"
  | "untraceable_source";

export type ReplanIntegrityIssue = {
  code: ReplanIntegrityIssueCode;
  message: string;
  sourceTaskId?: string;
};

type ReplanIntegritySummary = {
  remainingWorkMinutes: number;
  adjustedMinutes: number;
  issues: ReplanIntegrityIssue[];
};

export type GuardedReplanResult =
  | (ReplanIntegritySummary & {
      status: "valid";
      result: "change";
      adjustments: AdjustmentDraftItem[];
      rejectedAdjustments: [];
    })
  | (ReplanIntegritySummary & {
      status: "no_change";
      result: "no_change";
      adjustments: [];
      rejectedAdjustments: [];
    })
  | (ReplanIntegritySummary & {
      status: "invalid";
      result: "invalid";
      adjustments: [];
      rejectedAdjustments: AdjustmentDraftItem[];
    });

function duplicateIds(ids: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  return duplicates;
}

function issue(
  code: ReplanIntegrityIssueCode,
  message: string,
  sourceTaskId?: string,
): ReplanIntegrityIssue {
  return sourceTaskId ? { code, message, sourceTaskId } : { code, message };
}

export function guardMinimalReplanDraft(
  draft: MinimalReplanDraft,
  today: string,
  deadline: string,
): GuardedReplanResult {
  if (!isIsoDate(today) || !isIsoDate(deadline) || deadline < today) {
    throw new Error("调整草稿日期窗口无效。");
  }

  const issues: ReplanIntegrityIssue[] = [];
  const remainingIds = draft.remainingWork.map((item) => item.sourceTaskId);
  const adjustmentIds = draft.adjustments.map((item) => item.sourceTaskId);
  const duplicateRemainingIds = duplicateIds(remainingIds);
  const duplicateAdjustmentIds = duplicateIds(adjustmentIds);
  const frozenIds = new Set(draft.frozenHistory.map((task) => task.id));
  const unchangedFutureIds = new Set(
    draft.unchangedFuture.map((task) => task.id),
  );

  for (const sourceTaskId of duplicateRemainingIds) {
    issues.push(
      issue(
        "duplicate_remaining_work",
        "同一来源任务生成了重复的剩余工作。",
        sourceTaskId,
      ),
    );
  }

  for (const sourceTaskId of duplicateAdjustmentIds) {
    issues.push(
      issue(
        "duplicate_adjustment",
        "同一来源任务生成了重复的调整项。",
        sourceTaskId,
      ),
    );
  }

  const remainingBySource = new Map(
    draft.remainingWork.map((item) => [item.sourceTaskId, item]),
  );
  const adjustmentsBySource = new Map(
    draft.adjustments.map((item) => [item.sourceTaskId, item]),
  );

  for (const work of draft.remainingWork) {
    if (!work.sourceTaskId) {
      issues.push(issue("untraceable_source", "剩余工作缺少来源任务 ID。"));
      continue;
    }
    if (frozenIds.has(work.sourceTaskId)) {
      issues.push(
        issue(
          "completed_task_reintroduced",
          "已完成任务不能重新进入剩余工作。",
          work.sourceTaskId,
        ),
      );
    }
    if (unchangedFutureIds.has(work.sourceTaskId)) {
      issues.push(
        issue(
          "active_task_duplicated",
          "同一任务不能同时保留完整未来任务和剩余片段。",
          work.sourceTaskId,
        ),
      );
    }
    if (!adjustmentsBySource.has(work.sourceTaskId)) {
      issues.push(
        issue(
          "missing_adjustment",
          "剩余工作缺少对应的调整项。",
          work.sourceTaskId,
        ),
      );
    }
  }

  for (const adjustment of draft.adjustments) {
    if (!adjustment.sourceTaskId) {
      issues.push(issue("untraceable_source", "调整项缺少来源任务 ID。"));
      continue;
    }

    const work = remainingBySource.get(adjustment.sourceTaskId);
    if (!work) {
      issues.push(
        issue(
          "unexpected_adjustment",
          "调整项无法追溯到剩余工作。",
          adjustment.sourceTaskId,
        ),
      );
      continue;
    }

    if (
      adjustment.remainingDuration !== work.remainingDuration ||
      adjustment.fromDate !== work.fromDate
    ) {
      issues.push(
        issue(
          "duration_mismatch",
          "调整项的来源日期或剩余时长与剩余工作不一致。",
          adjustment.sourceTaskId,
        ),
      );
    }

    if (
      !isIsoDate(adjustment.toDate) ||
      adjustment.toDate < today ||
      adjustment.toDate > deadline
    ) {
      issues.push(
        issue(
          "date_out_of_bounds",
          "调整日期超出今天至截止日期的闭区间。",
          adjustment.sourceTaskId,
        ),
      );
    }
  }

  const remainingWorkMinutes = draft.remainingWork.reduce(
    (total, item) => total + item.remainingDuration,
    0,
  );
  const adjustedMinutes = draft.adjustments.reduce(
    (total, item) => total + item.remainingDuration,
    0,
  );

  if (remainingWorkMinutes !== adjustedMinutes) {
    issues.push(
      issue(
        "duration_mismatch",
        "调整草稿总时长与重排前的剩余总时长不一致。",
      ),
    );
  }

  if (issues.length > 0) {
    return {
      status: "invalid",
      result: "invalid",
      remainingWorkMinutes,
      adjustedMinutes,
      adjustments: [],
      rejectedAdjustments: draft.adjustments.map((item) => ({ ...item })),
      issues,
    };
  }

  if (draft.remainingWork.length === 0 && draft.adjustments.length === 0) {
    return {
      status: "no_change",
      result: "no_change",
      remainingWorkMinutes: 0,
      adjustedMinutes: 0,
      adjustments: [],
      rejectedAdjustments: [],
      issues: [],
    };
  }

  return {
    status: "valid",
    result: "change",
    remainingWorkMinutes,
    adjustedMinutes,
    adjustments: draft.adjustments,
    rejectedAdjustments: [],
    issues: [],
  };
}

export function createGuardedReplanDraft(
  tasks: ReplanTask[],
  today: string,
  deadline: string,
) {
  const draft = createMinimalReplanDraft(tasks, today, deadline);
  return {
    draft,
    integrity: guardMinimalReplanDraft(draft, today, deadline),
  };
}
