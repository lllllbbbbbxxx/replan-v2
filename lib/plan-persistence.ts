import { isValidFeedback, type TaskFeedback } from "./plan-state.ts";
import {
  confirmVersionedReplanPreview,
  normalizePlanVersion,
  type ReplanPreview,
} from "./replan-preview.ts";
import type { ReplanTask } from "./replan.ts";

export type PlanSource = {
  type: "github";
  name: string;
  url: string;
};

export type PlanSnapshot = {
  id: string;
  title: string;
  description: string;
  deadline: string;
  createdAt: string;
  planVersion: number;
  lastUpdatedAt: string;
  source?: PlanSource;
  steps: ReplanTask[];
};

export type PersistedPlan = PlanSnapshot & {
  originalPlan: PlanSnapshot;
  previousPlanSnapshot: PlanSnapshot | null;
};

export type GeneratedPlan = Omit<
  PlanSnapshot,
  "planVersion" | "lastUpdatedAt"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneTask(task: ReplanTask): ReplanTask {
  return task.feedback
    ? { ...task, feedback: { ...task.feedback } }
    : { ...task };
}

function cloneSource(source?: PlanSource) {
  return source ? { ...source } : undefined;
}

function cloneSnapshot(snapshot: PlanSnapshot): PlanSnapshot {
  return {
    id: snapshot.id,
    title: snapshot.title,
    description: snapshot.description,
    deadline: snapshot.deadline,
    createdAt: snapshot.createdAt,
    planVersion: snapshot.planVersion,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    ...(snapshot.source ? { source: { ...snapshot.source } } : {}),
    steps: snapshot.steps.map(cloneTask),
  };
}

function normalizeSource(value: unknown): PlanSource | undefined {
  if (
    !isRecord(value) ||
    value.type !== "github" ||
    typeof value.name !== "string" ||
    typeof value.url !== "string"
  ) {
    return undefined;
  }

  return { type: "github", name: value.name, url: value.url };
}

function normalizeTask(value: unknown): ReplanTask {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.detail !== "string" ||
    typeof value.scheduledDate !== "string" ||
    typeof value.estimatedMinutes !== "number" ||
    !Number.isFinite(value.estimatedMinutes) ||
    value.estimatedMinutes < 0
  ) {
    throw new Error("Invalid saved task");
  }

  const feedback = value.feedback as TaskFeedback | undefined;
  if (isValidFeedback(feedback)) {
    return {
      id: value.id,
      title: value.title,
      detail: value.detail,
      scheduledDate: value.scheduledDate,
      estimatedMinutes: value.estimatedMinutes,
      feedback: { ...feedback },
    };
  }

  if (value.completed === true) {
    return {
      id: value.id,
      title: value.title,
      detail: value.detail,
      scheduledDate: value.scheduledDate,
      estimatedMinutes: value.estimatedMinutes,
      feedback: { status: "completed", percent: 100 },
    };
  }

  return {
    id: value.id,
    title: value.title,
    detail: value.detail,
    scheduledDate: value.scheduledDate,
    estimatedMinutes: value.estimatedMinutes,
  };
}

function normalizeSnapshot(
  value: unknown,
  fallbackUpdatedAt?: string,
): PlanSnapshot {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.deadline !== "string" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.steps)
  ) {
    throw new Error("Invalid saved plan");
  }

  const source = normalizeSource(value.source);
  const lastUpdatedAt =
    typeof value.lastUpdatedAt === "string" && value.lastUpdatedAt
      ? value.lastUpdatedAt
      : fallbackUpdatedAt ?? value.createdAt;

  return {
    id: value.id,
    title: value.title,
    description:
      typeof value.description === "string" ? value.description : "",
    deadline: value.deadline,
    createdAt: value.createdAt,
    planVersion: normalizePlanVersion(value.planVersion),
    lastUpdatedAt,
    ...(source ? { source } : {}),
    steps: value.steps.map(normalizeTask),
  };
}

export function createPersistedPlan(
  input: GeneratedPlan,
  updatedAt = new Date().toISOString(),
): PersistedPlan {
  const current: PlanSnapshot = {
    id: input.id,
    title: input.title,
    description: input.description,
    deadline: input.deadline,
    createdAt: input.createdAt,
    ...(input.source ? { source: cloneSource(input.source) } : {}),
    steps: input.steps.map(cloneTask),
    planVersion: 1,
    lastUpdatedAt: updatedAt,
  };

  return {
    ...current,
    originalPlan: cloneSnapshot(current),
    previousPlanSnapshot: null,
  };
}

export function restorePersistedPlan(serialized: string): PersistedPlan {
  const parsed = JSON.parse(serialized) as unknown;
  const current = normalizeSnapshot(parsed);
  const record = parsed as Record<string, unknown>;
  const originalPlan = record.originalPlan
    ? normalizeSnapshot(record.originalPlan, current.createdAt)
    : cloneSnapshot(current);
  const previousPlanSnapshot = record.previousPlanSnapshot
    ? normalizeSnapshot(record.previousPlanSnapshot, current.lastUpdatedAt)
    : null;

  return {
    ...current,
    originalPlan,
    previousPlanSnapshot,
  };
}

function snapshotCurrentPlan(plan: PersistedPlan): PlanSnapshot {
  return cloneSnapshot(plan);
}

export function confirmPersistedReplan(
  plan: PersistedPlan,
  preview: ReplanPreview,
  updatedAt = new Date().toISOString(),
): PersistedPlan {
  const previousPlanSnapshot = snapshotCurrentPlan(plan);
  const confirmed = confirmVersionedReplanPreview(plan, preview);

  return {
    ...confirmed,
    lastUpdatedAt: updatedAt,
    originalPlan: cloneSnapshot(plan.originalPlan),
    previousPlanSnapshot,
  };
}

export function undoLastReplan(
  plan: PersistedPlan,
  updatedAt = new Date().toISOString(),
): PersistedPlan {
  if (!plan.previousPlanSnapshot) return plan;

  const restored = cloneSnapshot(plan.previousPlanSnapshot);
  return {
    ...restored,
    planVersion: plan.planVersion + 1,
    lastUpdatedAt: updatedAt,
    originalPlan: cloneSnapshot(plan.originalPlan),
    previousPlanSnapshot: null,
  };
}
