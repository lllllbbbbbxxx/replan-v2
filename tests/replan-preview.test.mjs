import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelReplanPreview,
  confirmReplanPreview,
  confirmVersionedReplanPreview,
  createReplanPreview,
  normalizePlanVersion,
} from "../lib/replan-preview.ts";

const TODAY = "2026-08-03";
const DEADLINE = "2026-08-08";

function createPlan() {
  return [
    {
      id: "T-001",
      title: "阅读资料",
      detail: "阅读项目资料",
      scheduledDate: TODAY,
      estimatedMinutes: 60,
    },
    {
      id: "T-002",
      title: "数据清理",
      detail: "整理原始数据",
      scheduledDate: TODAY,
      estimatedMinutes: 120,
    },
    {
      id: "T-003",
      title: "撰写初稿",
      detail: "完成第一版",
      scheduledDate: "2026-08-04",
      estimatedMinutes: 120,
    },
    {
      id: "T-004",
      title: "最终校对",
      detail: "检查并提交",
      scheduledDate: "2026-08-08",
      estimatedMinutes: 60,
    },
  ];
}

test("FR-06 creates a preview without changing the original plan", () => {
  const plan = createPlan();
  const before = JSON.stringify(plan);

  const preview = createReplanPreview(
    plan,
    "T-002",
    { status: "partial", percent: 50 },
    TODAY,
    DEADLINE,
  );

  assert.equal(JSON.stringify(plan), before);
  assert.equal(plan[1].feedback, undefined);
  assert.equal(plan[1].scheduledDate, TODAY);
  assert.deepEqual(preview.changes.shortened, [
    {
      sourceTaskId: "T-002",
      title: "数据清理",
      originalDuration: 120,
      remainingDuration: 60,
    },
  ]);
  assert.deepEqual(preview.changes.moved, [
    {
      sourceTaskId: "T-002",
      title: "数据清理",
      fromDate: TODAY,
      toDate: "2026-08-04",
      remainingDuration: 60,
    },
  ]);
  assert.deepEqual(
    preview.changes.unchanged.map((item) => item.sourceTaskId),
    ["T-003", "T-004"],
  );
});

test("FR-06 previews completed work as removed but preserves its history", () => {
  const plan = createPlan();
  const preview = createReplanPreview(
    plan,
    "T-001",
    { status: "completed", percent: 100 },
    TODAY,
    DEADLINE,
  );

  assert.deepEqual(preview.changes.removed, [
    {
      sourceTaskId: "T-001",
      title: "阅读资料",
      date: TODAY,
    },
  ]);

  const confirmed = confirmReplanPreview(plan, preview);
  assert.equal(confirmed.length, plan.length);
  assert.equal(confirmed[0].title, "阅读资料");
  assert.equal(confirmed[0].scheduledDate, TODAY);
  assert.equal(confirmed[0].estimatedMinutes, 60);
  assert.deepEqual(confirmed[0].feedback, {
    status: "completed",
    percent: 100,
  });
});

test("FR-06 confirmation applies feedback and movement exactly once", () => {
  const plan = createPlan();
  const preview = createReplanPreview(
    plan,
    "T-002",
    { status: "partial", percent: 50 },
    TODAY,
    DEADLINE,
  );

  const confirmed = confirmReplanPreview(plan, preview);

  assert.notStrictEqual(confirmed, plan);
  assert.deepEqual(confirmed[1].feedback, {
    status: "partial",
    percent: 50,
  });
  assert.equal(confirmed[1].scheduledDate, "2026-08-04");
  assert.equal(
    confirmed.filter((task) => task.id === "T-002").length,
    1,
  );
  assert.deepEqual(confirmed[2], plan[2]);
  assert.deepEqual(confirmed[3], plan[3]);
});

test("FR-06 cancellation returns the untouched original plan", () => {
  const plan = createPlan();
  const before = JSON.parse(JSON.stringify(plan));
  createReplanPreview(
    plan,
    "T-002",
    { status: "partial", percent: 75 },
    TODAY,
    DEADLINE,
  );

  const cancelled = cancelReplanPreview(plan);

  assert.strictEqual(cancelled, plan);
  assert.deepEqual(cancelled, before);
});

test("FR-06 rejects confirmation if the original plan changed", () => {
  const plan = createPlan();
  const preview = createReplanPreview(
    plan,
    "T-002",
    { status: "not_completed", percent: 0 },
    TODAY,
    DEADLINE,
  );
  const changedPlan = plan.map((task) =>
    task.id === "T-003" ? { ...task, title: "已被修改" } : task,
  );

  assert.throws(
    () => confirmReplanPreview(changedPlan, preview),
    /原计划已发生变化/,
  );
});

test("FR-06 rejects unknown tasks without changing the plan", () => {
  const plan = createPlan();
  const before = JSON.stringify(plan);

  assert.throws(
    () =>
      createReplanPreview(
        plan,
        "UNKNOWN",
        { status: "completed", percent: 100 },
        TODAY,
        DEADLINE,
      ),
    /找不到要反馈的任务/,
  );
  assert.equal(JSON.stringify(plan), before);
});

test("FR-06 keeps planVersion stable during preview and cancellation", () => {
  const plan = { planVersion: 1, steps: createPlan() };

  const preview = createReplanPreview(
    plan.steps,
    "T-002",
    { status: "partial", percent: 50 },
    TODAY,
    DEADLINE,
    plan.planVersion,
  );
  const cancelledSteps = cancelReplanPreview(plan.steps);

  assert.equal(plan.planVersion, 1);
  assert.equal(preview.basePlanVersion, 1);
  assert.strictEqual(cancelledSteps, plan.steps);
  assert.equal(plan.planVersion, 1);
});

test("FR-06 confirmation increments planVersion exactly once", () => {
  const plan = { planVersion: 1, steps: createPlan() };
  const preview = createReplanPreview(
    plan.steps,
    "T-002",
    { status: "partial", percent: 50 },
    TODAY,
    DEADLINE,
    plan.planVersion,
  );

  const confirmed = confirmVersionedReplanPreview(plan, preview);

  assert.equal(plan.planVersion, 1);
  assert.equal(confirmed.planVersion, 2);
  assert.deepEqual(confirmed.steps[1].feedback, {
    status: "partial",
    percent: 50,
  });
  assert.throws(
    () => confirmVersionedReplanPreview(confirmed, preview),
    /计划版本已发生变化/,
  );
  assert.equal(confirmed.planVersion, 2);
});

test("FR-06 initializes missing or invalid legacy versions at one", () => {
  assert.equal(normalizePlanVersion(undefined), 1);
  assert.equal(normalizePlanVersion(0), 1);
  assert.equal(normalizePlanVersion(1.5), 1);
  assert.equal(normalizePlanVersion(3), 3);
});
