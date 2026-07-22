import { NextResponse } from "next/server";
import { getGitHubContext } from "../../../lib/github";
import { isIsoDate, RawStep, scheduleSteps } from "../../../lib/planner";

type PlanRequest = {
  title?: unknown;
  description?: unknown;
  deadline?: unknown;
  today?: unknown;
};

type DeepSeekResponse = {
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

const taskPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: 3,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "estimated_minutes"],
        properties: {
          title: { type: "string", minLength: 2, maxLength: 80 },
          detail: { type: "string", minLength: 2, maxLength: 180 },
          estimated_minutes: {
            type: "integer",
            minimum: 15,
            maximum: 240,
          },
        },
      },
    },
  },
} as const;

function getRuntimeValue(key: "DEEPSEEK_API_KEY" | "DEEPSEEK_MODEL") {
  return process.env[key];
}

function friendlyApiError(status: number) {
  if (status === 401) return "API Key 无效，请检查 .env.local 后重启服务。";
  if (status === 429) return "API 调用额度不足或请求过快，请稍后再试。";
  return "AI 暂时没有完成拆解，请稍后重试。";
}

export async function POST(request: Request) {
  let body: PlanRequest;
  try {
    body = (await request.json()) as PlanRequest;
  } catch {
    return NextResponse.json({ error: "请求内容无效。" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const deadline = typeof body.deadline === "string" ? body.deadline : "";
  const today = typeof body.today === "string" ? body.today : "";

  if (!title || title.length > 120) {
    return NextResponse.json(
      { error: "任务名称需要控制在 1–120 个字符内。" },
      { status: 400 },
    );
  }
  if (description.length > 500) {
    return NextResponse.json(
      { error: "补充说明不能超过 500 个字符。" },
      { status: 400 },
    );
  }
  if (!isIsoDate(today) || !isIsoDate(deadline) || deadline < today) {
    return NextResponse.json(
      { error: "请选择今天或之后的截止日期。" },
      { status: 400 },
    );
  }

  const apiKey = getRuntimeValue("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return NextResponse.json(
      { error: "还没有配置 DeepSeek API Key，请先填写 .env.local 并重启服务。" },
      { status: 503 },
    );
  }

  const model = getRuntimeValue("DEEPSEEK_MODEL") || "deepseek-v4-flash";
  const githubTask = /github(?:\.com)?/i.test(`${title}\n${description}`);
  const githubContext = githubTask
    ? await getGitHubContext(`${title}\n${description}`)
    : null;

  if (githubTask && !githubContext) {
    return NextResponse.json(
      {
        error:
          "没能确定你指的是哪个 GitHub 仓库。请在任务或补充说明中粘贴完整仓库链接。",
      },
      { status: 422 },
    );
  }

  const userContext = [
    `任务：${title}`,
    `截止日期：${deadline}`,
    description ? `补充说明：${description}` : "",
    githubContext?.promptContext ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  let deepSeekResponse: Response;
  try {
    deepSeekResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "你是一个务实的任务规划助手。请把用户的大任务拆成 3 到 10 个按执行顺序排列的步骤。",
              "步骤必须具体、可执行、彼此不重复，并从准备工作推进到最终交付或检查。",
              "用简洁自然的中文输出。title 写动作，detail 写明确的完成标准。",
              "estimated_minutes 估计单次专注完成该步骤所需时间，必须是 15 到 240 之间的整数。",
              "如果用户要学习 GitHub 项目，并提供了仓库资料，必须基于 README 与目录生成针对该项目的学习步骤。",
              "每个学习步骤要明确写出真实的章节、模块、文件或实践主题，并在 detail 中给出可检查的学习产物，例如笔记、可运行代码或测试结果。",
              "禁止只给出“浏览 README”“了解项目结构”“学习核心功能”这类没有项目具体内容的泛化步骤。",
              "不要安排日期，不要输出解释或 Markdown。",
              `只返回符合此 JSON Schema 的 JSON 对象：${JSON.stringify(taskPlanSchema)}`,
            ].join("\n"),
          },
          { role: "user", content: userContext },
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接 DeepSeek，请检查网络后重试。" },
      { status: 502 },
    );
  }

  let responseBody: DeepSeekResponse;
  try {
    responseBody = (await deepSeekResponse.json()) as DeepSeekResponse;
  } catch {
    return NextResponse.json(
      { error: "DeepSeek 返回了无法读取的响应，请稍后重试。" },
      { status: 502 },
    );
  }

  if (!deepSeekResponse.ok) {
    console.error(
      "DeepSeek API error",
      deepSeekResponse.status,
      responseBody.error,
    );
    return NextResponse.json(
      { error: friendlyApiError(deepSeekResponse.status) },
      { status: deepSeekResponse.status === 429 ? 429 : 502 },
    );
  }

  try {
    const outputText = responseBody.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(outputText) as {
      steps?: RawStep[];
    };
    if (
      !Array.isArray(parsed.steps) ||
      parsed.steps.length < 3 ||
      parsed.steps.some(
        (step) =>
          typeof step?.title !== "string" ||
          typeof step?.detail !== "string" ||
          typeof step?.estimated_minutes !== "number",
      )
    ) {
      throw new Error("Invalid steps");
    }

    const steps = scheduleSteps(parsed.steps, today, deadline);
    return NextResponse.json({
      plan: {
        id: crypto.randomUUID(),
        title,
        description,
        deadline,
        createdAt: new Date().toISOString(),
        source: githubContext?.source,
        steps,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "AI 返回的计划格式不完整，请重新生成。" },
      { status: 502 },
    );
  }
}
