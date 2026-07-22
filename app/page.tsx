"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { markStepComplete } from "../lib/plan-state";

type PlanStep = {
  id: string;
  title: string;
  detail: string;
  estimatedMinutes: number;
  scheduledDate: string;
  completed: boolean;
};

type Plan = {
  id: string;
  title: string;
  description: string;
  deadline: string;
  createdAt: string;
  source?: {
    type: "github";
    name: string;
    url: string;
  };
  steps: PlanStep[];
};

type DayGroup = {
  date: string;
  steps: PlanStep[];
};

const STORAGE_KEY = "replan:mvp-plan";
const pad = (value: number) => String(value).padStart(2, "0");

function toLocalDateString(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(year, month - 1, day));
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function buildDayGroups(plan: Plan): DayGroup[] {
  const groups = new Map<string, PlanStep[]>();
  for (const step of plan.steps) {
    const current = groups.get(step.scheduledDate) ?? [];
    current.push(step);
    groups.set(step.scheduledDate, current);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, steps]) => ({ date, steps }));
}

export default function Home() {
  const today = useMemo(() => toLocalDateString(new Date()), []);
  const defaultDeadline = useMemo(
    () => toLocalDateString(addLocalDays(new Date(), 6)),
    [],
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    const loadSavedPlan = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) setPlan(JSON.parse(saved) as Plan);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHasLoadedStorage(true);
      }
    }, 0);

    return () => window.clearTimeout(loadSavedPlan);
  }, []);

  useEffect(() => {
    if (!hasLoadedStorage) return;
    if (plan) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [plan, hasLoadedStorage]);

  const completedCount = plan?.steps.filter((step) => step.completed).length ?? 0;
  const progress = plan?.steps.length
    ? Math.round((completedCount / plan.steps.length) * 100)
    : 0;
  const dayGroups = plan ? buildDayGroups(plan) : [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("先写下你想完成的大任务。");
      return;
    }
    if (deadline < today) {
      setError("截止日期不能早于今天。");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          description: description.trim(),
          deadline,
          today,
        }),
      });
      const result = (await response.json()) as {
        plan?: Plan;
        error?: string;
      };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "生成计划失败，请稍后再试。");
      }

      setPlan(result.plan);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "生成计划失败，请稍后再试。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function completeStep(stepId: string) {
    setPlan((current) => {
      if (!current) return current;
      const nextSteps = markStepComplete(current.steps, stepId);
      return nextSteps === current.steps
        ? current
        : { ...current, steps: nextSteps };
    });
  }

  function resetPlan() {
    if (!window.confirm("清空当前计划并重新开始？")) return;
    setPlan(null);
    setTitle("");
    setDescription("");
    setDeadline(defaultDeadline);
    setError("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Replan 首页">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>replan</span>
        </a>
        <p className="topbar-note">把压力，变成下一步。</p>
      </header>

      <div className={`workspace ${plan ? "workspace-with-plan" : ""}`}>
        <section className="composer" aria-labelledby="composer-title">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            七天行动计划
          </div>
          <h1 id="composer-title">
            一个大任务，
            <br />
            从这里变小。
          </h1>
          <p className="intro">
            告诉 Replan 你要完成什么。我们会拆成清晰步骤，并安排到接下来的七天。
          </p>

          <form onSubmit={handleSubmit} className="plan-form">
            <label htmlFor="task-title">你想完成什么？</label>
            <textarea
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：完成新版产品发布方案"
              maxLength={120}
              rows={3}
              disabled={isLoading}
              required
            />

            <div className="form-row">
              <div className="field">
                <label htmlFor="deadline">截止日期</label>
                <input
                  id="deadline"
                  type="date"
                  value={deadline}
                  min={today}
                  onChange={(event) => setDeadline(event.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="field field-optional">
                <label htmlFor="description">
                  补充说明 <span>选填</span>
                </label>
                <input
                  id="description"
                  type="text"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="GitHub 链接、范围或已有进度"
                  maxLength={500}
                  disabled={isLoading}
                />
              </div>
            </div>

            {error ? (
              <div className="error-message" role="alert">
                <span aria-hidden="true">!</span>
                {error}
              </div>
            ) : null}

            <button className="primary-button" type="submit" disabled={isLoading}>
              <span>
                {isLoading
                  ? "正在拆解任务…"
                  : plan
                    ? "重新生成计划"
                    : "生成我的七天计划"}
              </span>
              <span className={isLoading ? "loading-dot" : ""} aria-hidden="true">
                {isLoading ? "" : "↗"}
              </span>
            </button>
          </form>

          <div className="trust-line" aria-label="产品说明">
            <span>无需登录</span>
            <span>仅保存在本机</span>
            <span>随时可以清空</span>
          </div>
        </section>

        <section className="plan-panel" aria-live="polite">
          {plan ? (
            <>
              <div className="plan-header">
                <div>
                  <p className="plan-kicker">当前计划</p>
                  <h2>{plan.title}</h2>
                  <p className="deadline-copy">
                    截止于 {formatDate(plan.deadline)} · {plan.steps.length} 个步骤
                  </p>
                  {plan.source ? (
                    <a
                      className="source-link"
                      href={plan.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      已读取 {plan.source.name}
                      <span aria-hidden="true">↗</span>
                    </a>
                  ) : null}
                </div>
                <button className="text-button" type="button" onClick={resetPlan}>
                  清空
                </button>
              </div>

              <div className="progress-block">
                <div className="progress-copy">
                  <span>{progress === 100 ? "全部完成" : "整体进度"}</span>
                  <strong>{progress}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="计划完成进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p>
                  已完成 {completedCount} / {plan.steps.length}
                </p>
              </div>

              <div className="timeline">
                {dayGroups.map((group, groupIndex) => (
                  <article className="day-group" key={group.date}>
                    <div className="day-marker" aria-hidden="true">
                      <span>{groupIndex + 1}</span>
                      {groupIndex < dayGroups.length - 1 ? <i /> : null}
                    </div>
                    <div className="day-content">
                      <div className="day-heading">
                        <h3>{formatDate(group.date)}</h3>
                        {group.date === today ? <span>今天</span> : null}
                      </div>
                      <div className="step-list">
                        {group.steps.map((step) => (
                          <button
                            type="button"
                            className={`step-card ${step.completed ? "is-complete" : ""}`}
                            key={step.id}
                            onClick={() => completeStep(step.id)}
                            disabled={step.completed}
                            aria-label={
                              step.completed
                                ? `${step.title}，已完成`
                                : `将“${step.title}”标记为完成`
                            }
                          >
                            <span className="custom-check" aria-hidden="true">
                              ✓
                            </span>
                            <span className="step-copy">
                              <strong>{step.title}</strong>
                              <span>{step.detail}</span>
                            </span>
                            <span className="duration">
                              {minutesLabel(step.estimatedMinutes)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {progress === 100 ? (
                <div className="completion-card">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>计划完成。</strong>
                    <p>做得很好。现在可以清空计划，开始下一个目标。</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-plan">
              <div className="empty-orbit" aria-hidden="true">
                <span>1</span>
                <i>2</i>
                <b>3</b>
              </div>
              <p className="empty-kicker">你的计划会出现在这里</p>
              <h2>七天，不是用来焦虑的。</h2>
              <p>
                它们可以是一条清晰的路径：先准备，再推进，最后交付。现在只需要写下目标。
              </p>
              <div className="empty-example">
                <span>示例</span>
                <p>“在下周一之前，完成作品集网站并发布。”</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <footer>
        <span>Replan MVP</span>
        <span>一次只完成下一步。</span>
      </footer>
    </main>
  );
}
