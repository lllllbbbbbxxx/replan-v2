import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  isIsoDate,
  normalizeEstimatedMinutes,
  scheduleSteps,
} from "../lib/planner.ts";

const sampleSteps = [
  { title: "确认范围", detail: "写下交付标准", estimated_minutes: 30 },
  { title: "收集资料", detail: "整理必要输入", estimated_minutes: 60 },
  { title: "完成初稿", detail: "产出可审阅版本", estimated_minutes: 120 },
  { title: "修改完善", detail: "处理所有反馈", estimated_minutes: 90 },
  { title: "最终交付", detail: "检查并提交成品", estimated_minutes: 30 },
];

test("validates and increments ISO dates", () => {
  assert.equal(isIsoDate("2026-07-21"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
});

test("schedules in order inside the next seven days", () => {
  const steps = scheduleSteps(sampleSteps, "2026-07-21", "2026-08-20");
  assert.equal(steps.length, sampleSteps.length);
  assert.equal(steps[0].scheduledDate, "2026-07-21");
  assert.equal(steps.at(-1).scheduledDate, "2026-07-27");
  assert.ok(
    steps.every(
      (step) =>
        step.scheduledDate >= "2026-07-21" &&
        step.scheduledDate <= "2026-07-27",
    ),
  );
  assert.deepEqual(
    [...steps].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    steps,
  );
  assert.ok(steps.every((step) => step.feedback === undefined));
});

test("respects an earlier deadline", () => {
  const steps = scheduleSteps(sampleSteps, "2026-07-21", "2026-07-23");
  assert.equal(steps.at(-1).scheduledDate, "2026-07-23");
  assert.ok(steps.every((step) => step.scheduledDate <= "2026-07-23"));
});

test("rejects past deadlines", () => {
  assert.throws(
    () => scheduleSteps(sampleSteps, "2026-07-21", "2026-07-20"),
    /不能早于今天/,
  );
});

test("rounds estimates to five minutes without cumulative total drift", () => {
  const rawMinutes = [63, 77, 42, 28];
  const normalized = normalizeEstimatedMinutes(rawMinutes);
  const rawTotal = rawMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const normalizedTotal = normalized.reduce(
    (sum, minutes) => sum + minutes,
    0,
  );

  assert.deepEqual(normalized, [65, 75, 40, 30]);
  assert.ok(normalized.every((minutes) => minutes % 5 === 0));
  assert.ok(Math.abs(normalizedTotal - rawTotal) <= 2.5);
});

test("clamps invalid and out-of-range estimates before total rounding", () => {
  assert.deepEqual(
    normalizeEstimatedMinutes([Number.NaN, 5, 242, 239]),
    [15, 15, 240, 240],
  );
});
