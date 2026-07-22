"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createFeedbackDraft,
  feedbackLabel,
  FeedbackDraft,
  FeedbackStatus,
  isValidFeedback,
  PartialPercent,
  submitTaskFeedback,
  TaskFeedback,
} from "../lib/plan-state";

type PlanStep = {
  id: string;
  title: string;
  detail: string;
  estimatedMinutes: number;
  scheduledDate: string;
  feedback?: TaskFeedback;
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
const FEEDBACK_OPTIONS: Array<{
  status: FeedbackStatus;
  label: string;
}> = [
  { status: "completed", label: "完成" },
  { status: "partial", label: "部分完成" },
  { status: "not_completed", label: "未完成" },
];
const PARTIAL_OPTIONS: PartialPercent[] = [25, 50, 75];
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

function normalizeSavedPlan(value: string): Plan {
  type LegacyStep = Omit<PlanStep, "feedback"> & {
    completed?: boolean;
    feedback?: TaskFeedback;
  };
  type LegacyPlan = Omit<Plan, "steps"> & { steps: LegacyStep[] };

  const parsed = JSON.parse(value) as LegacyPlan;
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error("Invalid saved plan");
  }

  return {
    ...parsed,
    steps: parsed.steps.map(({ completed, feedback, ...step }) => {
      if (isValidFeedback(feedback)) return { ...step, feedback };
      if (completed) {
        return {
          ...step,
          feedback: { status: "completed", percent: 100 },
        } satisfies PlanStep;
      }
      return step;
    }),
  };
}

function feedbackClass(feedback?: TaskFeedback) {
  if (!feedback) return "";
  return `is-${feedback.status.replace("_", "-")}`;
}

function feedbackSymbol(feedback?: TaskFeedback) {
  if (!feedback) return "";
  if (feedback.status === "completed") return "✓";
  if (feedback.status === "not_completed") return "—";
  return `${feedback.percent}%`;
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
  const [feedbackDrafts, setFeedbackDrafts] = useState<
    Record<string, FeedbackDraft>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    const loadSavedPlan = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) setPlan(normalizeSavedPlan(saved));
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

  const completedCount =
    plan?.steps.filter((step) => step.feedback?.status === "completed").length ??
    0;
  const feedbackCount =
    plan?.steps.filter((step) => step.feedback !== undefined).length ?? 0;
  const progress = plan?.steps.length
    ? Math.round(
        plan.steps.reduce(
          (sum, step) => sum + (step.feedback?.percent ?? 0),
          0,
        ) / plan.steps.length,
      )
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
      setFeedbackDrafts({});
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

  function chooseFeedbackStatus(
    stepId: string,
    status: FeedbackStatus,
    savedFeedback?: TaskFeedback,
  ) {
    const savedPartial =
      status === "partial" && savedFeedback?.status === "partial"
        ? savedFeedback.percent
        : null;
    setFeedbackDrafts((current) => ({
      ...current,
      [stepId]: createFeedbackDraft(status, savedPartial),
    }));
  }

  function choosePartialPercent(stepId: string, percent: PartialPercent) {
    setFeedbackDrafts((current) => ({
      ...current,
      [stepId]: createFeedbackDraft("partial", percent),
    }));
  }

  function submitFeedback(stepId: string) {
    const draft = feedbackDrafts[stepId];
    if (!isValidFeedback(draft)) return;

    setPlan((current) => {
      if (!current) return current;
      const nextSteps = submitTaskFeedback(current.steps, stepId, draft);
      return nextSteps === current.steps
        ? current
        : { ...current, steps: nextSteps };
    });

    setFeedbackDrafts((current) => {
      const next = { ...current };
      delete next[stepId];
      return next;
    });
  }

  function resetPlan() {
    if (!window.confirm("清空当前计划并重新开始？")) return;
    setPlan(null);
    setFeedbackDrafts({});
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
                  已反馈 {feedbackCount} / {plan.steps.length} · 完成 {completedCount} 项
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
                        {group.steps.map((step) => {
                          const draft = feedbackDrafts[step.id];
                          const selectedStatus = draft?.status ?? step.feedback?.status;
                          const isToday = group.date === today;

                          return (
                            <article
                              className={`step-card ${feedbackClass(step.feedback)}`}
                              key={step.id}
                            >
                              <div className="step-main">
                                <span
                                  className="feedback-indicator"
                                  aria-hidden="true"
                                >
                                  {feedbackSymbol(step.feedback)}
                                </span>
                                <span className="step-copy">
                                  <strong>{step.title}</strong>
                                  <span>{step.detail}</span>
                                </span>
                                <span className="duration">
                                  {minutesLabel(step.estimatedMinutes)}
                                </span>
                              </div>

                              {isToday ? (
                                <div className="feedback-panel">
                                  <div className="feedback-meta">
                                    <strong>今日反馈</strong>
                                    <span className="feedback-meta-badges">
                                      {step.feedback ? (
                                        <span className="saved-feedback">
                                          已保存：{feedbackLabel(step.feedback)}
                                        </span>
                                      ) : (
                                        <span className="saved-feedback is-empty">
                                          尚未反馈
                                        </span>
                                      )}
                                      {draft ? (
                                        <span className="draft-feedback">待提交</span>
                                      ) : null}
                                    </span>
                                  </div>

                                  <div
                                    className="feedback-status-options"
                                    role="group"
                                    aria-label={`${step.title}的完成状态`}
                                  >
                                    {FEEDBACK_OPTIONS.map((option) => (
                                      <button
                                        className={`feedback-option status-${option.status.replace("_", "-")} ${selectedStatus === option.status ? "is-selected" : ""}`}
                                        type="button"
                                        key={option.status}
                                        aria-pressed={selectedStatus === option.status}
                                        onClick={() =>
                                          chooseFeedbackStatus(
                                            step.id,
                                            option.status,
                                            step.feedback,
                                          )
                                        }
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>

                                  {draft?.status === "partial" ? (
                                    <div
                                      className="partial-options"
                                      role="group"
                                      aria-label="选择部分完成比例"
                                    >
                                      {PARTIAL_OPTIONS.map((percent) => (
                                        <button
                                          className={`partial-option ${draft.percent === percent ? "is-selected" : ""}`}
                                          type="button"
                                          key={percent}
                                          aria-pressed={draft.percent === percent}
                                          onClick={() =>
                                            choosePartialPercent(step.id, percent)
                                          }
                                        >
                                          完成 {percent}%
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}

                                  {draft ? (
                                    <div className="feedback-submit-row">
                                      <span>提交前不会修改原计划</span>
                                      <button
                                        className="submit-feedback-button"
                                        type="button"
                                        disabled={!isValidFeedback(draft)}
                                        onClick={() => submitFeedback(step.id)}
                                      >
                                        提交反馈
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : step.feedback ? (
                                <p className="historical-feedback">
                                  {feedbackLabel(step.feedback)}
                                </p>
                              ) : null}
                            </article>
                          );
                        })}
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
