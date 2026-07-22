import assert from "node:assert/strict";
import test from "node:test";
import {
  createFeedbackDraft,
  isValidFeedback,
  submitTaskFeedback,
} from "../lib/plan-state.ts";

test("choosing feedback creates a draft without changing the plan", () => {
  const steps = [{ id: "step-1", title: "今天的任务" }];
  const draft = createFeedbackDraft("partial");

  assert.deepEqual(draft, { status: "partial", percent: null });
  assert.equal(isValidFeedback(draft), false);
  assert.equal(steps[0].feedback, undefined);
});

test("submitting a feedback status stores one current value", () => {
  const steps = [{ id: "step-1" }, { id: "step-2" }];
  const next = submitTaskFeedback(
    steps,
    "step-1",
    createFeedbackDraft("completed"),
  );

  assert.deepEqual(next[0].feedback, { status: "completed", percent: 100 });
  assert.equal(next[1].feedback, undefined);
  assert.equal(next.length, 2);
});

test("new feedback overwrites the old status instead of accumulating", () => {
  const completed = submitTaskFeedback(
    [{ id: "step-1" }],
    "step-1",
    createFeedbackDraft("completed"),
  );
  const partial = submitTaskFeedback(
    completed,
    "step-1",
    createFeedbackDraft("partial", 50),
  );
  const notCompleted = submitTaskFeedback(
    partial,
    "step-1",
    createFeedbackDraft("not_completed"),
  );

  assert.deepEqual(partial[0].feedback, { status: "partial", percent: 50 });
  assert.deepEqual(notCompleted[0].feedback, {
    status: "not_completed",
    percent: 0,
  });
  assert.deepEqual(Object.keys(notCompleted[0]), ["id", "feedback"]);
});

test("incomplete partial feedback and unknown task leave plan unchanged", () => {
  const steps = [{ id: "step-1" }];
  assert.strictEqual(
    submitTaskFeedback(steps, "step-1", createFeedbackDraft("partial")),
    steps,
  );
  assert.strictEqual(
    submitTaskFeedback(steps, "missing", createFeedbackDraft("completed")),
    steps,
  );
});

test("submitting the same status twice is idempotent", () => {
  const once = submitTaskFeedback(
    [{ id: "step-1" }],
    "step-1",
    createFeedbackDraft("partial", 75),
  );
  const twice = submitTaskFeedback(
    once,
    "step-1",
    createFeedbackDraft("partial", 75),
  );

  assert.strictEqual(twice, once);
});

test("submitted feedback survives a JSON storage round trip", () => {
  const submitted = submitTaskFeedback(
    [{ id: "step-1", title: "可持久化任务" }],
    "step-1",
    createFeedbackDraft("partial", 25),
  );
  const restored = JSON.parse(JSON.stringify(submitted));

  assert.deepEqual(restored[0].feedback, { status: "partial", percent: 25 });
  assert.equal(restored[0].title, "可持久化任务");
});
