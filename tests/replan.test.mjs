import assert from "node:assert/strict";
import test from "node:test";
import {
  createMinimalReplanDraft,
  createRemainingWork,
  freezeCompletedTasks,
} from "../lib/replan.ts";

const TODAY = "2026-08-03";
const DEADLINE = "2026-08-07";

function createPlan() {
  return [
    {
      id: "T-001",
      title: "收集资料",
      detail: "整理写作需要的资料",
      scheduledDate: "2026-08-03",
      estimatedMinutes: 120,
    },
    {
      id: "T-002",
      title: "整理提纲",
      detail: "完成文章结构提纲",
      scheduledDate: "2026-08-03",
      estimatedMinutes: 60,
    },
    {
      id: "T-003",
      title: "撰写初稿",
      detail: "完成可审阅初稿",
      scheduledDate: "2026-08-04",
      estimatedMinutes: 120,
    },
    {
      id: "T-004",
      title: "修改结构",
      detail: "根据初稿调整结构",
      scheduledDate: "2026-08-05",
      estimatedMinutes: 60,
    },
    {
      id: "T-005",
      title: "校对内容",
      detail: "完成全文校对",
      scheduledDate: "2026-08-06",
      estimatedMinutes: 60,
    },
    {
      id: "T-006",
      title: "检查并提交",
      detail: "检查后提交成品",
      scheduledDate: "2026-08-07",
      estimatedMinutes: 30,
    },
  ];
}

function withFeedback(task, feedback) {
  return { ...task, feedback };
}

test("FR-03 freezes completed tasks without changing their history", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  const completedBefore = { ...plan[0], feedback: { ...plan[0].feedback } };

  const frozen = freezeCompletedTasks(plan);

  assert.equal(frozen.length, 1);
  assert.strictEqual(frozen[0], plan[0]);
  assert.deepEqual(frozen[0], completedBefore);
  assert.equal(frozen[0].id, "T-001");
  assert.equal(frozen[0].scheduledDate, TODAY);
  assert.equal(frozen[0].estimatedMinutes, 120);
});

test("FR-03 excludes completed tasks from remaining work", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  plan[1] = withFeedback(plan[1], {
    status: "not_completed",
    percent: 0,
  });

  const remaining = createRemainingWork(plan, TODAY);

  assert.deepEqual(remaining, [
    {
      sourceTaskId: "T-002",
      title: "整理提纲",
      detail: "完成文章结构提纲",
      fromDate: TODAY,
      originalDuration: 60,
      completedDuration: 0,
      remainingDuration: 60,
    },
  ]);
  assert.equal(remaining.some((item) => item.sourceTaskId === "T-001"), false);
});

test("FR-03 freezing is idempotent and keeps one historical record", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });

  const first = createMinimalReplanDraft(plan, TODAY, DEADLINE);
  const second = createMinimalReplanDraft(plan, TODAY, DEADLINE);

  assert.deepEqual(second, first);
  assert.equal(second.frozenHistory.length, 1);
  assert.equal(second.frozenHistory[0].feedback.percent, 100);
  assert.equal(
    second.adjustments.some((item) => item.sourceTaskId === "T-001"),
    false,
  );
});

test("FR-03 future changes cannot mutate completed task fields", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  const completedSnapshot = JSON.parse(JSON.stringify(plan[0]));
  plan[2] = { ...plan[2], scheduledDate: "2026-08-06" };

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);

  assert.deepEqual(draft.frozenHistory[0], completedSnapshot);
  assert.equal(draft.frozenHistory[0].title, "收集资料");
  assert.equal(draft.frozenHistory[0].estimatedMinutes, 120);
  assert.equal(draft.frozenHistory[0].scheduledDate, TODAY);
});

test("FR-04 drafts only today's unfinished work and preserves future tasks", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  plan[1] = withFeedback(plan[1], {
    status: "not_completed",
    percent: 0,
  });
  const futureSnapshot = JSON.parse(JSON.stringify(plan.slice(2)));

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);

  assert.deepEqual(draft.adjustments, [
    {
      sourceTaskId: "T-002",
      action: "move",
      fromDate: TODAY,
      toDate: "2026-08-04",
      remainingDuration: 60,
    },
  ]);
  assert.deepEqual(draft.unchangedFuture, futureSnapshot);
  assert.strictEqual(draft.unchangedFuture[0], plan[2]);
});

test("FR-04 carries only the true partial remainder", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "partial", percent: 50 });
  plan[1] = withFeedback(plan[1], { status: "completed", percent: 100 });

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);

  assert.equal(draft.adjustments.length, 1);
  assert.deepEqual(draft.adjustments[0], {
    sourceTaskId: "T-001",
    action: "move",
    fromDate: TODAY,
    toDate: "2026-08-04",
    remainingDuration: 60,
  });
  assert.equal(draft.remainingWork[0].originalDuration, 120);
  assert.equal(draft.remainingWork[0].completedDuration, 60);
});

test("FR-04 keeps each remaining source once without rewriting the future", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], {
    status: "not_completed",
    percent: 0,
  });
  plan[1] = withFeedback(plan[1], {
    status: "not_completed",
    percent: 0,
  });
  const before = JSON.parse(JSON.stringify(plan));

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);
  const sourceIds = draft.adjustments.map((item) => item.sourceTaskId);

  assert.equal(
    draft.adjustments.reduce(
      (total, item) => total + item.remainingDuration,
      0,
    ),
    180,
  );
  assert.deepEqual(sourceIds, ["T-001", "T-002"]);
  assert.equal(new Set(sourceIds).size, sourceIds.length);
  assert.deepEqual(plan, before);
  assert.deepEqual(
    draft.unchangedFuture.map((task) => task.id),
    ["T-003", "T-004", "T-005", "T-006"],
  );
});

test("FR-04 returns no change when today's tasks are complete", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  plan[1] = withFeedback(plan[1], { status: "completed", percent: 100 });
  const before = JSON.parse(JSON.stringify(plan));

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);

  assert.equal(draft.result, "no_change");
  assert.deepEqual(draft.remainingWork, []);
  assert.deepEqual(draft.adjustments, []);
  assert.deepEqual(plan, before);
  assert.deepEqual(draft.unchangedFuture, plan.slice(2));
});

test("FR-04 stays date-level and does not introduce capacity or time slots", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "partial", percent: 75 });

  const draft = createMinimalReplanDraft(plan, TODAY, DEADLINE);
  const adjustment = draft.adjustments[0];

  assert.deepEqual(Object.keys(adjustment), [
    "sourceTaskId",
    "action",
    "fromDate",
    "toDate",
    "remainingDuration",
  ]);
  assert.equal("dailyHours" in adjustment, false);
  assert.equal("startTime" in adjustment, false);
  assert.equal("endTime" in adjustment, false);
  assert.equal("isFeasible" in adjustment, false);
});
