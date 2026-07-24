import { PLAN_GENERATION_CACHE_SCHEMA } from "../db/schema.ts";
import type { RawStep } from "./planner";

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type PlanCacheDatabase = {
  prepare(query: string): D1PreparedStatement;
};

export type PlanCacheStore = {
  get(key: string): Promise<string | null>;
  putIfAbsent(key: string, value: string): Promise<void>;
};

const initializationPromises = new WeakMap<object, Promise<void>>();

function ensureCacheTable(database: PlanCacheDatabase) {
  const existing = initializationPromises.get(database);
  if (existing) return existing;

  const initialization = database
    .prepare(PLAN_GENERATION_CACHE_SCHEMA)
    .run()
    .then(() => undefined);
  initializationPromises.set(database, initialization);
  return initialization;
}

export function createD1PlanCache(
  database: PlanCacheDatabase,
): PlanCacheStore {
  return {
    async get(key) {
      await ensureCacheTable(database);
      const row = await database
        .prepare(
          "SELECT steps_json FROM plan_generation_cache WHERE cache_key = ?",
        )
        .bind(key)
        .first<{ steps_json?: unknown }>();

      return typeof row?.steps_json === "string" ? row.steps_json : null;
    },
    async putIfAbsent(key, value) {
      await ensureCacheTable(database);
      await database
        .prepare(
          "INSERT OR IGNORE INTO plan_generation_cache (cache_key, steps_json, created_at) VALUES (?, ?, ?)",
        )
        .bind(key, value, new Date().toISOString())
        .run();
    },
  };
}

function cloneSteps(steps: RawStep[]) {
  return steps.map((step) => ({ ...step }));
}

function deserializeSteps(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as RawStep[];
    if (!Array.isArray(parsed)) return null;
    return cloneSteps(parsed);
  } catch {
    return null;
  }
}

export async function getCachedGeneratedSteps(
  store: PlanCacheStore,
  key: string,
) {
  return deserializeSteps(await store.get(key));
}

export async function cacheGeneratedSteps(
  store: PlanCacheStore,
  key: string,
  steps: RawStep[],
) {
  await store.putIfAbsent(key, JSON.stringify(steps));

  // INSERT OR IGNORE makes the first completed generation canonical. Reading it
  // back also keeps concurrent cold-start requests consistent across Workers.
  return (
    deserializeSteps(await store.get(key)) ??
    cloneSteps(steps)
  );
}
