import assert from "node:assert/strict";
import test from "node:test";
import { markStepComplete } from "../lib/plan-state.ts";

test("marking an already completed step is idempotent", () => {
  const initial = Array.from({ length: 6 }, (_, index) => ({
    id: `step-${index + 1}`,
    completed: false,
  }));

  const completedOnce = markStepComplete(initial, "step-1");
  const completedAgain = markStepComplete(completedOnce, "step-1");
  const completedRepeatedly = Array.from({ length: 5 }).reduce(
    (steps) => markStepComplete(steps, "step-1"),
    completedAgain,
  );

  assert.equal(
    completedRepeatedly.filter((step) => step.completed).length,
    1,
  );
  assert.equal(completedRepeatedly.length, 6);
  assert.deepEqual(
    completedRepeatedly.map((step) => step.id),
    initial.map((step) => step.id),
  );
  assert.strictEqual(completedAgain, completedOnce);
  assert.strictEqual(completedRepeatedly, completedOnce);
});

test("marking an unknown step leaves state unchanged", () => {
  const steps = [{ id: "step-1", completed: false }];
  assert.strictEqual(markStepComplete(steps, "missing"), steps);
});
