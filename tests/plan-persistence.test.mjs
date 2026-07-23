import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmPersistedReplan,
  createPersistedPlan,
  restorePersistedPlan,
  undoLastReplan,
} from "../lib/plan-persistence.ts";
import { createReplanPreview } from "../lib/replan-preview.ts";

const TODAY = "2026-08-03";
const DEADLINE = "2026-08-08";
const CREATED_AT = "2026-08-03T08:00:00.000Z";
const CONFIRMED_AT = "2026-08-03T09:00:00.000Z";
const UNDONE_AT = "2026-08-03T09:05:00.000Z";

function createGeneratedPlan() {
  return {
    id: "PLAN-FR-001",
    title: "完成研究报告",
    description: "按计划完成报告",
    deadline: DEADLINE,
    createdAt: CREATED_AT,
    steps: [
      {
        id: "T-001",
        title: "数据清理",
        detail: "整理原始数据",
        scheduledDate: TODAY,
        estimatedMinutes: 120,
      },
      {
        id: "T-002",
        title: "撰写初稿",
        detail: "完成第一版",
        scheduledDate: "2026-08-04",
        estimatedMinutes: 120,
      },
    ],
  };
}

function confirmPartialPlan(plan) {
  const preview = createReplanPreview(
    plan.steps,
    "T-001",
    { status: "partial", percent: 50 },
    TODAY,
    plan.deadline,
    plan.planVersion,
  );
  return confirmPersistedReplan(plan, preview, CONFIRMED_AT);
}

test("FR-08 initializes the complete persistent plan envelope", () => {
  const plan = createPersistedPlan(createGeneratedPlan(), CREATED_AT);

  assert.equal(plan.planVersion, 1);
  assert.equal(plan.lastUpdatedAt, CREATED_AT);
  assert.equal(plan.previousPlanSnapshot, null);
  assert.deepEqual(plan.originalPlan.steps, plan.steps);
  assert.notStrictEqual(plan.originalPlan.steps, plan.steps);
  assert.equal(plan.originalPlan.planVersion, 1);
});

test("FR-07 confirmation stores the complete previous snapshot", () => {
  const plan = createPersistedPlan(createGeneratedPlan(), CREATED_AT);
  const confirmed = confirmPartialPlan(plan);

  assert.equal(confirmed.planVersion, 2);
  assert.equal(confirmed.lastUpdatedAt, CONFIRMED_AT);
  assert.deepEqual(confirmed.steps[0].feedback, {
    status: "partial",
    percent: 50,
  });
  assert.equal(confirmed.steps[0].scheduledDate, "2026-08-04");
  assert.ok(confirmed.previousPlanSnapshot);
  assert.deepEqual(confirmed.previousPlanSnapshot.steps, plan.steps);
  assert.equal(confirmed.previousPlanSnapshot.planVersion, 1);
  assert.deepEqual(confirmed.originalPlan, plan.originalPlan);
});

test("FR-07 undo restores task state, date and duration", () => {
  const plan = createPersistedPlan(createGeneratedPlan(), CREATED_AT);
  const confirmed = confirmPartialPlan(plan);

  const undone = undoLastReplan(confirmed, UNDONE_AT);

  assert.deepEqual(undone.steps, plan.steps);
  assert.equal(undone.steps[0].feedback, undefined);
  assert.equal(undone.steps[0].scheduledDate, TODAY);
  assert.equal(undone.steps[0].estimatedMinutes, 120);
  assert.equal(undone.planVersion, 3);
  assert.equal(undone.lastUpdatedAt, UNDONE_AT);
  assert.equal(undone.previousPlanSnapshot, null);
  assert.deepEqual(undone.originalPlan, plan.originalPlan);
});

test("FR-07 repeated undo is idempotent and creates no duplicates", () => {
  const plan = createPersistedPlan(createGeneratedPlan(), CREATED_AT);
  const confirmed = confirmPartialPlan(plan);
  const undone = undoLastReplan(confirmed, UNDONE_AT);

  const repeated = undoLastReplan(undone, "2026-08-03T09:06:00.000Z");

  assert.strictEqual(repeated, undone);
  assert.equal(repeated.planVersion, 3);
  assert.equal(new Set(repeated.steps.map((task) => task.id)).size, 2);
  assert.equal(repeated.steps.length, 2);
});

test("FR-08 refresh restores feedback, replan result and undo ability", () => {
  const plan = createPersistedPlan(createGeneratedPlan(), CREATED_AT);
  const confirmed = confirmPartialPlan(plan);

  const restored = restorePersistedPlan(JSON.stringify(confirmed));

  assert.deepEqual(restored, confirmed);
  assert.equal(restored.planVersion, 2);
  assert.equal(restored.lastUpdatedAt, CONFIRMED_AT);
  assert.ok(restored.previousPlanSnapshot);
  assert.deepEqual(restored.steps[0].feedback, {
    status: "partial",
    percent: 50,
  });
  assert.equal(restored.steps[0].scheduledDate, "2026-08-04");

  const undoneAfterRefresh = undoLastReplan(restored, UNDONE_AT);
  assert.equal(undoneAfterRefresh.steps[0].feedback, undefined);
  assert.equal(undoneAfterRefresh.steps[0].scheduledDate, TODAY);
});

test("FR-08 migrates a legacy locally saved plan without duplication", () => {
  const legacyPlan = {
    ...createGeneratedPlan(),
    planVersion: 2,
    steps: [
      {
        ...createGeneratedPlan().steps[0],
        completed: true,
      },
      createGeneratedPlan().steps[1],
    ],
  };

  const restored = restorePersistedPlan(JSON.stringify(legacyPlan));

  assert.equal(restored.planVersion, 2);
  assert.equal(restored.lastUpdatedAt, CREATED_AT);
  assert.deepEqual(restored.steps[0].feedback, {
    status: "completed",
    percent: 100,
  });
  assert.deepEqual(restored.originalPlan.steps, restored.steps);
  assert.equal(restored.previousPlanSnapshot, null);
  assert.equal(new Set(restored.steps.map((task) => task.id)).size, 2);
});
