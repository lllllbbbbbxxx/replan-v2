import type { RawStep } from "./planner";

const PLAN_CACHE_VERSION = 2;

type PlanCacheKeyInput = {
  model: string;
  taskContext: string;
};

export async function createPlanCacheKey(input: PlanCacheKeyInput) {
  const source = JSON.stringify([
    PLAN_CACHE_VERSION,
    input.model,
    input.taskContext,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function parseGeneratedSteps(content: string): RawStep[] {
  const parsed = JSON.parse(content) as {
    steps?: RawStep[];
  };

  if (
    !Array.isArray(parsed.steps) ||
    parsed.steps.length < 3 ||
    parsed.steps.length > 10 ||
    parsed.steps.some(
      (step) =>
        typeof step?.title !== "string" ||
        typeof step?.detail !== "string" ||
        typeof step?.estimated_minutes !== "number" ||
        !Number.isFinite(step.estimated_minutes),
    )
  ) {
    throw new Error("Invalid steps");
  }

  return parsed.steps;
}
