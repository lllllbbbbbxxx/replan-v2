export type CompletableStep = {
  id: string;
  completed: boolean;
};

export function markStepComplete<T extends CompletableStep>(
  steps: T[],
  stepId: string,
): T[] {
  let changed = false;

  const nextSteps = steps.map((step) => {
    if (step.id !== stepId || step.completed) return step;
    changed = true;
    return { ...step, completed: true };
  });

  return changed ? nextSteps : steps;
}
