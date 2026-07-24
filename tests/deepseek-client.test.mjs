import assert from "node:assert/strict";
import test from "node:test";
import { requestDeepSeekCompletion } from "../lib/deepseek-client.ts";

const validContent = JSON.stringify({
  steps: [
    { title: "步骤一", detail: "完成一", estimated_minutes: 30 },
    { title: "步骤二", detail: "完成二", estimated_minutes: 45 },
    { title: "步骤三", detail: "完成三", estimated_minutes: 60 },
  ],
});

function successResponse({
  content = validContent,
  finishReason = "stop",
} = {}) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finishReason,
          message: { content },
        },
      ],
    }),
    { status: 200 },
  );
}

const noWait = async () => {};

test("retries a transient network failure and then succeeds", async () => {
  let calls = 0;
  const result = await requestDeepSeekCompletion({
    apiKey: "test-key",
    payload: { model: "test-model" },
    sleep: noWait,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return successResponse();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("retries 429 and server errors but stops after three attempts", async () => {
  const statuses = [429, 503, 503];
  const result = await requestDeepSeekCompletion({
    apiKey: "test-key",
    payload: { model: "test-model" },
    sleep: noWait,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "busy" } }), {
        status: statuses.shift(),
      }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "api");
  assert.equal(result.status, 503);
  assert.equal(result.attempts, 3);
});

test("does not retry a non-retryable authentication error", async () => {
  let calls = 0;
  const result = await requestDeepSeekCompletion({
    apiKey: "bad-key",
    payload: { model: "test-model" },
    sleep: noWait,
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: "unauthorized" } }),
        { status: 401 },
      );
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, "api");
  assert.equal(result.status, 401);
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test("increases token limit when the response is truncated", async () => {
  const tokenLimits = [];
  const result = await requestDeepSeekCompletion({
    apiKey: "test-key",
    payload: { model: "test-model" },
    sleep: noWait,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      tokenLimits.push(body.max_tokens);
      return tokenLimits.length === 1
        ? successResponse({ finishReason: "length" })
        : successResponse();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(tokenLimits, [1800, 2600]);
});

test("retries a malformed plan and returns the next valid result", async () => {
  let calls = 0;
  const result = await requestDeepSeekCompletion({
    apiKey: "test-key",
    payload: { model: "test-model" },
    sleep: noWait,
    validateContent: (content) => content === validContent,
    fetchImpl: async () => {
      calls += 1;
      return successResponse({
        content: calls === 1 ? '{"steps":[]}' : validContent,
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});
