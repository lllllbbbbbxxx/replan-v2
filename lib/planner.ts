export type RawStep = {
  title: string;
  detail: string;
  estimated_minutes: number;
};

export type ScheduledStep = {
  id: string;
  title: string;
  detail: string;
  estimatedMinutes: number;
  scheduledDate: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function scheduleSteps(
  rawSteps: RawStep[],
  today: string,
  deadline: string,
): ScheduledStep[] {
  if (!isIsoDate(today) || !isIsoDate(deadline)) {
    throw new Error("日期格式无效。");
  }
  if (deadline < today) {
    throw new Error("截止日期不能早于今天。");
  }

  const lastDay = deadline < addDays(today, 6) ? deadline : addDays(today, 6);
  const dates: string[] = [];
  for (let date = today; date <= lastDay; date = addDays(date, 1)) {
    dates.push(date);
  }

  const steps = rawSteps.slice(0, 10).map((step) => ({
    title: step.title.trim().slice(0, 80),
    detail: step.detail.trim().slice(0, 180),
    estimatedMinutes: Math.max(
      15,
      Math.min(240, Math.round(step.estimated_minutes / 5) * 5),
    ),
  }));

  const totalMinutes = steps.reduce(
    (sum, step) => sum + step.estimatedMinutes,
    0,
  );
  let elapsedMinutes = 0;

  return steps.map((step, index) => {
    let dayIndex = 0;

    if (steps.length === 1) {
      dayIndex = dates.length - 1;
    } else if (steps.length <= dates.length) {
      dayIndex = Math.round((index / (steps.length - 1)) * (dates.length - 1));
    } else if (index === steps.length - 1) {
      dayIndex = dates.length - 1;
    } else {
      dayIndex = Math.min(
        dates.length - 1,
        Math.floor((elapsedMinutes / totalMinutes) * dates.length),
      );
    }

    elapsedMinutes += step.estimatedMinutes;

    return {
      id: crypto.randomUUID(),
      title: step.title,
      detail: step.detail,
      estimatedMinutes: step.estimatedMinutes,
      scheduledDate: dates[dayIndex],
    };
  });
}
