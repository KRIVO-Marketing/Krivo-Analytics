// Camada compartilhada de leitura e cache em memória para as abas do painel.
import { ApiError, apiRead, opsCall } from "./api";
import type { Me } from "./auth";
import { cachedFetch, getCached, setCached } from "./cache";
import type { Contact, Interaction, Member, Task } from "./ops";
import type { Goal, Info, Metrics, Property, RealtimeMetrics } from "./types";

const METRICS_TTL_MS = 5 * 60_000;
const CONTACT_TTL_MS = 2 * 60_000;

export type ContactDetail = {
  contact: Contact;
  interactions: Interaction[];
  tasks: { id: string; title: string; status: string; due_date: string | null }[];
};

export const CACHE_KEYS = {
  team: "team",
  tasks: "tasks",
  contacts: "contacts",
  properties: "properties",
  info: "info",
  goals: "goals",
  metrics: (propertyId: string, days: number) => `metrics:${propertyId}:${days}`,
  contactDetail: (id: string) => `contact:${id}`,
} as const;

export const fetchTeam = (force = false) =>
  cachedFetch(
    CACHE_KEYS.team,
    () => opsCall<{ members: Member[] }>({ action: "team" }).then((r) => r.members),
    { force },
  );

export const fetchTasks = (force = false) =>
  cachedFetch(
    CACHE_KEYS.tasks,
    () => opsCall<{ tasks: Task[] }>({ action: "tasks_list" }).then((r) => r.tasks),
    { force },
  );

export const fetchContacts = (force = false) =>
  cachedFetch(
    CACHE_KEYS.contacts,
    () => opsCall<{ contacts: Contact[] }>({ action: "contacts_list" }).then((r) => r.contacts),
    { force },
  );

export const fetchProperties = (force = false) =>
  cachedFetch(
    CACHE_KEYS.properties,
    () => apiRead<{ properties: Property[] }>({ action: "list" }).then((r) => r.properties),
    { force },
  );

export const fetchInfo = (force = false) =>
  cachedFetch(CACHE_KEYS.info, () => apiRead<Info>({ action: "info" }), { force });

export const fetchGoals = (force = false) =>
  cachedFetch(
    CACHE_KEYS.goals,
    () => apiRead<{ goals: Goal[] }>({ action: "goals_list" }).then((r) => r.goals),
    { force },
  );

export const fetchMetrics = (propertyId: string, days: number, options?: { force?: boolean; signal?: AbortSignal }) =>
  cachedFetch(
    CACHE_KEYS.metrics(propertyId, days),
    () => apiRead<Metrics>({ action: "metrics", id: propertyId, days, force: !!options?.force }, options?.signal),
    { ttlMs: METRICS_TTL_MS, force: options?.force },
  );

export const prefetchMetrics = (propertyId: string, days = 28) => {
  if (getCached<Metrics>(CACHE_KEYS.metrics(propertyId, days))) return;
  void fetchMetrics(propertyId, days).catch(() => {});
};

export const fetchContactDetail = (id: string, force = false) =>
  cachedFetch(
    CACHE_KEYS.contactDetail(id),
    () => opsCall<ContactDetail>({ action: "contact_get", id }),
    { ttlMs: CONTACT_TTL_MS, force },
  );

export const prefetchContactDetail = (id: string) => {
  if (getCached<ContactDetail>(CACHE_KEYS.contactDetail(id))) return;
  void fetchContactDetail(id).catch(() => {});
};

export const fetchRealtime = (propertyId: string, signal?: AbortSignal) =>
  apiRead<RealtimeMetrics>({ action: "realtime", id: propertyId }, signal);

export function updateTasksCache(updater: (prev: Task[]) => Task[]) {
  const prev = getCached<Task[]>(CACHE_KEYS.tasks) ?? [];
  return setCached(CACHE_KEYS.tasks, updater(prev));
}

export function updateContactsCache(updater: (prev: Contact[]) => Contact[]) {
  const prev = getCached<Contact[]>(CACHE_KEYS.contacts) ?? [];
  return setCached(CACHE_KEYS.contacts, updater(prev));
}

export async function bootstrapApp(): Promise<Me> {
  try {
    const res = await opsCall<{ user: Me; members: Member[]; tasks: Task[]; contacts: Contact[] }>({ action: "bootstrap" });
    setCached(CACHE_KEYS.team, res.members);
    setCached(CACHE_KEYS.tasks, res.tasks);
    setCached(CACHE_KEYS.contacts, res.contacts);
    return res.user;
  } catch (e) {
    // Retrocompatível se a função ops-api ainda não tiver sido republicada com a ação bootstrap.
    if (e instanceof ApiError && e.code === "acao_invalida") {
      const r = await apiRead<{ user: Me }>({ action: "me" });
      return r.user;
    }
    throw e;
  }
}
