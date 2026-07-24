export type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type DeepSeekFailureKind =
  | "api"
  | "invalid_response"
  | "network"
  | "truncated";

export type DeepSeekResult =
  | {
      ok: true;
      attempts: number;
      body: DeepSeekResponse;
      content: string;
    }
  | {
      ok: false;
      attempts: number;
      body?: DeepSeekResponse;
      kind: DeepSeekFailureKind;
      status?: number;
    };

type DeepSeekRequestOptions = {
  apiKey: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  tokenLimits?: number[];
  validateContent?: (content: string) => boolean;
};

const DEFAULT_TOKEN_LIMITS = [1800, 2600, 3400];

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shouldRetryStatus(status: number) {
  return status === 429 || status >= 500;
}

export async function requestDeepSeekCompletion({
  apiKey,
  payload,
  fetchImpl = fetch,
  sleep = defaultSleep,
  tokenLimits = DEFAULT_TOKEN_LIMITS,
  validateContent,
}: DeepSeekRequestOptions): Promise<DeepSeekResult> {
  const limits =
    tokenLimits.length > 0 ? tokenLimits : DEFAULT_TOKEN_LIMITS;

  for (let attemptIndex = 0; attemptIndex < limits.length; attemptIndex += 1) {
    const attempts = attemptIndex + 1;
    const hasNextAttempt = attempts < limits.length;
    let response: Response;

    try {
      response = await fetchImpl(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            max_tokens: limits[attemptIndex],
          }),
        },
      );
    } catch {
      if (!hasNextAttempt) {
        return { ok: false, attempts, kind: "network" };
      }
      await sleep(250 * 2 ** attemptIndex);
      continue;
    }

    let body: DeepSeekResponse;
    try {
      body = (await response.json()) as DeepSeekResponse;
    } catch {
      if (!hasNextAttempt) {
        return {
          ok: false,
          attempts,
          kind: "invalid_response",
          status: response.status,
        };
      }
      await sleep(250 * 2 ** attemptIndex);
      continue;
    }

    if (!response.ok) {
      if (hasNextAttempt && shouldRetryStatus(response.status)) {
        await sleep(250 * 2 ** attemptIndex);
        continue;
      }
      return {
        ok: false,
        attempts,
        body,
        kind: "api",
        status: response.status,
      };
    }

    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") {
      if (!hasNextAttempt) {
        return {
          ok: false,
          attempts,
          body,
          kind: "truncated",
          status: response.status,
        };
      }
      await sleep(250 * 2 ** attemptIndex);
      continue;
    }

    const content = choice?.message?.content ?? "";
    if (!content || (validateContent && !validateContent(content))) {
      if (!hasNextAttempt) {
        return {
          ok: false,
          attempts,
          body,
          kind: "invalid_response",
          status: response.status,
        };
      }
      await sleep(250 * 2 ** attemptIndex);
      continue;
    }

    return { ok: true, attempts, body, content };
  }

  return { ok: false, attempts: limits.length, kind: "network" };
}
