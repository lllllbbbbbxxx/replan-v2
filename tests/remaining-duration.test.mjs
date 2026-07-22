import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRemainingMinutes,
  calculateTotalOriginalMinutes,
  calculateTotalRemainingMinutes,
  REMAINING_ROUNDING_MINUTES,
} from "../lib/remaining-duration.ts";

test("calculates remaining time from the original duration", () => {
  assert.equal(
    calculateRemainingMinutes(120, { status: "completed", percent: 100 }),
    0,
  );
  assert.equal(
    calculateRemainingMinutes(120, { status: "partial", percent: 25 }),
    90,
  );
  assert.equal(
    calculateRemainingMinutes(120, { status: "partial", percent: 50 }),
    60,
  );
  assert.equal(
    calculateRemainingMinutes(120, { status: "partial", percent: 75 }),
    30,
  );
  assert.equal(calculateRemainingMinutes(120, { status: "not_started" }), 120);
  assert.equal(
    calculateRemainingMinutes(120, {
      status: "not_completed",
      percent: 0,
    }),
    120,
  );
  assert.equal(calculateRemainingMinutes(120), 120);
});

test("rounds positive remaining work up to a fixed 30-minute increment", () => {
  assert.equal(REMAINING_ROUNDING_MINUTES, 30);
  assert.equal(
    calculateRemainingMinutes(45, { status: "partial", percent: 50 }),
    30,
  );
  assert.equal(
    calculateRemainingMinutes(75, { status: "partial", percent: 50 }),
    60,
  );
});

test("never rounds an unfinished task down to zero", () => {
  assert.equal(
    calculateRemainingMinutes(15, { status: "partial", percent: 75 }),
    30,
  );
});

test("remaining durations cannot be negative", () => {
  assert.equal(calculateRemainingMinutes(-120), 0);
  assert.equal(
    calculateRemainingMinutes(-120, { status: "partial", percent: 25 }),
    0,
  );
});

test("totals remaining and original durations accurately", () => {
  const steps = [
    { estimatedMinutes: 120 },
    {
      estimatedMinutes: 120,
      feedback: { status: "partial", percent: 25 },
    },
    {
      estimatedMinutes: 120,
      feedback: { status: "partial", percent: 50 },
    },
    {
      estimatedMinutes: 120,
      feedback: { status: "partial", percent: 75 },
    },
    {
      estimatedMinutes: 120,
      feedback: { status: "completed", percent: 100 },
    },
    { estimatedMinutes: 120, feedback: { status: "not_started" } },
  ];

  assert.equal(calculateTotalOriginalMinutes(steps), 720);
  assert.equal(calculateTotalRemainingMinutes(steps), 420);
});
