import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheGeneratedSteps,
  getCachedGeneratedSteps,
} from "../lib/plan-generation-cache.ts";
import {
  createPlanCacheKey,
  parseGeneratedSteps,
} from "../lib/plan-generation.ts";

const sampleSteps = [
  { title: "确认范围", detail: "列出交付标准", estimated_minutes: 30 },
  { title: "完成实现", detail: "产出可运行版本", estimated_minutes: 90 },
  { title: "检查交付", detail: "测试并记录结果", estimated_minutes: 45 },
];

function createMemoryStore() {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async putIfAbsent(key, value) {
      if (!values.has(key)) values.set(key, value);
    },
  };
}

test("creates a stable, date-independent cache key for task context", async () => {
  const input = {
    model: "deepseek-test",
    taskContext: "任务：完成作品集",
  };

  assert.equal(
    await createPlanCacheKey(input),
    await createPlanCacheKey({ ...input }),
  );
  assert.notEqual(
    await createPlanCacheKey(input),
    await createPlanCacheKey({
      ...input,
      taskContext: "任务：完成另一个作品集",
    }),
  );
});

test("returns an isolated copy of persistent cached steps", async () => {
  const store = createMemoryStore();
  const key = await createPlanCacheKey({
    model: "deepseek-test",
    taskContext: "任务：完成作品集",
  });

  await cacheGeneratedSteps(store, key, sampleSteps);
  const firstRead = await getCachedGeneratedSteps(store, key);
  firstRead[0].estimated_minutes = 240;
  const secondRead = await getCachedGeneratedSteps(store, key);

  assert.equal(secondRead[0].estimated_minutes, 30);
});

test("keeps the first completed generation canonical across cold instances", async () => {
  const store = createMemoryStore();
  const key = await createPlanCacheKey({
    model: "deepseek-test",
    taskContext: "任务：完成作品集",
  });
  const competingSteps = sampleSteps.map((step) => ({
    ...step,
    estimated_minutes: 240,
  }));

  const first = await cacheGeneratedSteps(store, key, sampleSteps);
  const second = await cacheGeneratedSteps(store, key, competingSteps);

  assert.deepEqual(first, sampleSteps);
  assert.deepEqual(second, sampleSteps);
});

test("validates generated step count and fields", () => {
  assert.deepEqual(
    parseGeneratedSteps(JSON.stringify({ steps: sampleSteps })),
    sampleSteps,
  );
  assert.throws(
    () => parseGeneratedSteps('{"steps":[{"title":"缺少字段"}]}'),
    /Invalid steps/,
  );
});
