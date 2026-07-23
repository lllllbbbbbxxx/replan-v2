import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuardedReplanDraft,
  guardMinimalReplanDraft,
} from "../lib/replan-guard.ts";

const TODAY = "2026-08-03";
const DEADLINE = "2026-08-07";

function createPlan() {
  return [
    {
      id: "T-001",
      title: "相同标题",
      detail: "收集资料",
      scheduledDate: TODAY,
      estimatedMinutes: 120,
    },
    {
      id: "T-002",
      title: "相同标题",
      detail: "整理提纲",
      scheduledDate: TODAY,
      estimatedMinutes: 60,
    },
    {
      id: "T-003",
      title: "撰写初稿",
      detail: "完成初稿",
      scheduledDate: "2026-08-04",
      estimatedMinutes: 120,
    },
  ];
}

function withFeedback(task, feedback) {
  return { ...task, feedback };
}

function createValidDraft() {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "partial", percent: 50 });
  plan[1] = withFeedback(plan[1], {
    status: "not_completed",
    percent: 0,
  });
  return createGuardedReplanDraft(plan, TODAY, DEADLINE);
}

test("FR-05 conserves the FR-04 remaining duration exactly", () => {
  const { draft, integrity } = createValidDraft();

  assert.equal(integrity.status, "valid");
  assert.equal(integrity.remainingWorkMinutes, 120);
  assert.equal(integrity.adjustedMinutes, 120);
  assert.strictEqual(integrity.adjustments, draft.adjustments);
  assert.deepEqual(integrity.issues, []);
});

test("FR-05 rejects duplicate remaining work and duplicate adjustments", () => {
  const { draft } = createValidDraft();
  const duplicated = {
    ...draft,
    remainingWork: [...draft.remainingWork, { ...draft.remainingWork[0] }],
    adjustments: [...draft.adjustments, { ...draft.adjustments[0] }],
  };

  const result = guardMinimalReplanDraft(duplicated, TODAY, DEADLINE);

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.adjustments, []);
  assert.ok(
    result.issues.some((item) => item.code === "duplicate_remaining_work"),
  );
  assert.ok(
    result.issues.some((item) => item.code === "duplicate_adjustment"),
  );
});

test("FR-05 rejects a full future task duplicated as remaining work", () => {
  const { draft } = createValidDraft();
  const duplicatedSource = {
    ...draft,
    remainingWork: [
      ...draft.remainingWork,
      {
        sourceTaskId: "T-003",
        title: "撰写初稿",
        detail: "完成初稿",
        fromDate: "2026-08-04",
        originalDuration: 120,
        completedDuration: 0,
        remainingDuration: 120,
      },
    ],
    adjustments: [
      ...draft.adjustments,
      {
        sourceTaskId: "T-003",
        action: "keep",
        fromDate: "2026-08-04",
        toDate: "2026-08-04",
        remainingDuration: 120,
      },
    ],
  };

  const result = guardMinimalReplanDraft(
    duplicatedSource,
    TODAY,
    DEADLINE,
  );

  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === "active_task_duplicated" &&
        item.sourceTaskId === "T-003",
    ),
  );
});

test("FR-05 rejects dates outside the closed deadline window", () => {
  const { draft } = createValidDraft();
  const outOfBounds = {
    ...draft,
    adjustments: draft.adjustments.map((item, index) =>
      index === 0 ? { ...item, toDate: "2026-08-08" } : item,
    ),
  };

  const result = guardMinimalReplanDraft(outOfBounds, TODAY, DEADLINE);

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.adjustments, []);
  assert.equal(result.rejectedAdjustments[0].toDate, "2026-08-08");
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === "date_out_of_bounds" &&
        item.sourceTaskId === "T-001",
    ),
  );
});

test("FR-05 traces same-title tasks by sourceTaskId rather than title", () => {
  const { draft, integrity } = createValidDraft();

  assert.equal(draft.remainingWork[0].title, draft.remainingWork[1].title);
  assert.deepEqual(
    integrity.adjustments.map((item) => item.sourceTaskId),
    ["T-001", "T-002"],
  );
  assert.equal(new Set(integrity.adjustments.map((item) => item.sourceTaskId)).size, 2);
});

test("FR-05 rejects missing, unexpected and mismatched adjustments", () => {
  const { draft } = createValidDraft();
  const invalid = {
    ...draft,
    adjustments: [
      {
        ...draft.adjustments[0],
        remainingDuration: draft.adjustments[0].remainingDuration + 30,
      },
      {
        sourceTaskId: "UNKNOWN",
        action: "move",
        fromDate: TODAY,
        toDate: "2026-08-04",
        remainingDuration: 60,
      },
    ],
  };

  const result = guardMinimalReplanDraft(invalid, TODAY, DEADLINE);

  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((item) => item.code === "duration_mismatch"));
  assert.ok(result.issues.some((item) => item.code === "missing_adjustment"));
  assert.ok(result.issues.some((item) => item.code === "unexpected_adjustment"));
  assert.equal(result.adjustments.length, 0);
});

test("FR-05 never reintroduces completed work", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  plan[1] = withFeedback(plan[1], {
    status: "not_completed",
    percent: 0,
  });
  const { draft } = createGuardedReplanDraft(plan, TODAY, DEADLINE);
  const completedReintroduced = {
    ...draft,
    remainingWork: [
      ...draft.remainingWork,
      {
        sourceTaskId: "T-001",
        title: "相同标题",
        detail: "收集资料",
        fromDate: TODAY,
        originalDuration: 120,
        completedDuration: 120,
        remainingDuration: 60,
      },
    ],
    adjustments: [
      ...draft.adjustments,
      {
        sourceTaskId: "T-001",
        action: "move",
        fromDate: TODAY,
        toDate: "2026-08-04",
        remainingDuration: 60,
      },
    ],
  };

  const result = guardMinimalReplanDraft(
    completedReintroduced,
    TODAY,
    DEADLINE,
  );

  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === "completed_task_reintroduced" &&
        item.sourceTaskId === "T-001",
    ),
  );
});

test("FR-05 returns no_change for an empty adjustment draft", () => {
  const plan = createPlan();
  plan[0] = withFeedback(plan[0], { status: "completed", percent: 100 });
  plan[1] = withFeedback(plan[1], { status: "completed", percent: 100 });

  const { draft, integrity } = createGuardedReplanDraft(
    plan,
    TODAY,
    DEADLINE,
  );

  assert.equal(draft.result, "no_change");
  assert.equal(integrity.status, "no_change");
  assert.equal(integrity.result, "no_change");
  assert.equal(integrity.remainingWorkMinutes, 0);
  assert.equal(integrity.adjustedMinutes, 0);
  assert.deepEqual(integrity.adjustments, []);
  assert.deepEqual(integrity.rejectedAdjustments, []);
});

test("FR-05 remains date-level without capacity or time-slot fields", () => {
  const { integrity } = createValidDraft();
  const serialized = JSON.stringify(integrity);

  assert.equal(serialized.includes("startMinute"), false);
  assert.equal(serialized.includes("endMinute"), false);
  assert.equal(serialized.includes("availableMinutes"), false);
  assert.equal(serialized.includes("shortfallMinutes"), false);
  assert.equal(serialized.includes("insufficient_capacity"), false);
});
