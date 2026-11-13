// Painel KRIVO: App Shell estilo Bento SaaS (Sidebar branca com pill azul ativa + topbar limpa).
"use client";
import { useEffect, useRef, useState } from "react";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS } from "@/lib/data";
import { todayISO, type Contact, type Task } from "@/lib/ops";
import { useMe } from "./AuthGate";
import ClientsTab from "./ClientsTab";
import CrmTab from "./CrmTab";
import KrivoTab from "./KrivoTab";
import Logo from "./Logo";
import TasksTab from "./TasksTab";
import { ThemeToggle } from "./ThemeToggle";

const GROUPS = [
  {
    title: "Operação",
    items: [
      { id: "tarefas", label: "Tarefas", sub: "Fluxo operacional e entregas da equipe" },
      { id: "crm", label: "CRM", sub: "Pipeline comercial e retornos do dia" },
    ],
  },
  {
    title: "Análise",
    items: [
      { id: "krivo", label: "KRIVO", sub: "Meta de lucro e performance própria" },
      { id: "clientes", label: "Métricas", sub: "Propriedades GA4 e resultados de clientes" },
    ],
  },
] as const;

const TABS = [...GROUPS[0].items, ...GROUPS[1].items];
type TabId = (typeof TABS)[number]["id"];

function TabIcon({ id }: { id: TabId }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (id) {
    case "tarefas":
      return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
    case "crm":
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "krivo":
      return <svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>;
    case "clientes":
      return <svg {...props}><path d="M3 3v18h18" /><path d="M8 16v-5M13 16V7M18 16v-8" /></svg>;
  }
}

function useNavCounts() {
  const [counts, setCounts] = useState<{ tarefas: number; crm: number }>({ tarefas: 0, crm: 0 });

  useEffect(() => {
    const compute = () => {
      const tasks = getCached<Task[]>(CACHE_KEYS.tasks) ?? [];
      const contacts = getCached<Contact[]>(CACHE_KEYS.contacts) ?? [];
      const today = todayISO();
      const openTasks = tasks.filter((t) => t.status !== "concluida").length;
      const dueCrm = contacts.filter(
        (c) => !!c.next_contact_at && c.next_contact_at <= today && c.stage !== "fechado" && c.stage !== "perdido",
      ).length;
      setCounts({ tarefas: openTasks, crm: dueCrm });
    };
    compute();
    const u1 = subscribeCache(CACHE_KEYS.tasks, compute);
    const u2 = subscribeCache(CACHE_KEYS.contacts, compute);
    return () => {
      u1();
      u2();
    };
  }, []);

  return counts;
}

export default function App() {
  const { me, signOut } = useMe();
  const [tab, setTab] = useState<TabId>("tarefas");
  const [visited, setVisited] = useState<Record<TabId, boolean>>({ tarefas: true, crm: false, krivo: false, clientes: false });
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const counts = useNavCounts();

  const select = (id: TabId) => {
    setTab(id);
    setVisited((v) => ({ ...v, [id]: true }));
    refs.current[id]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select(TABS[(i + 1) % TABS.length].id);
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select(TABS[(i + TABS.length - 1) % TABS.length].id);
    }
  };

  const activeTab = TABS.find((t) => t.id === tab)!;
  const badgeFor = (id: TabId) => (id === "tarefas" ? counts.tarefas : id === "crm" ? counts.crm : 0);
  const initial = (me.email?.[0] ?? "K").toUpperCase();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar branca limpa no Desktop */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-card">
        <div className="flex h-16 items-center justify-between px-5">
          <Logo className="text-2xl text-ink" />
          <span className="rounded-lg bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-mute">
            Painel
          </span>
        </div>

        <nav className="flex-1 space-y-5 px-3 py-3" aria-label="Navegação principal">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-mute/80">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((t) => {
                  const active = tab === t.id;
                  const badge = badgeFor(t.id);
                  const idx = TABS.findIndex((x) => x.id === t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => select(t.id)}
                      onKeyDown={(e) => onKey(e, idx)}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                        active
                          ? "bg-[var(--accent)] text-white shadow-[0_6px_18px_rgba(63,81,255,0.28)]"
                          : "text-mute hover:bg-[var(--surface-2)] hover:text-ink"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <TabIcon id={t.id} />
                        <span>{t.label}</span>
                      </span>
                      {badge > 0 && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                            active
                              ? "bg-white/20 text-white"
                              : t.id === "crm"
                                ? "bg-[var(--neg-soft)] text-neg"
                                : "bg-[var(--surface-2)] text-mute"
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3">
          <div className="rounded-2xl bg-[#111827] p-4 text-white">
            <p className="text-xs font-medium text-white/70">KRIVO Workspace</p>
            <p className="mt-0.5 truncate text-sm font-semibold" title={me.email}>{me.email}</p>
            <p className="text-[11px] text-white/60">{me.role === "admin" ? "Administrador" : "Membro da equipe"}</p>
            <button
              type="button"
              onClick={signOut}
              className="mt-3 flex w-full items-center justify-center rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:bg-[var(--accent-2)]"
            >
              Sair da conta
            </button>
          </div>
        </div>
      </aside>

      {/* Coluna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar compacta no Mobile */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-card/90 px-4 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2.5">
            <Logo className="text-xl text-ink" />
            <span className="h-3.5 w-px bg-line" aria-hidden />
            <span className="text-sm font-medium text-mute">{activeTab.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-9 items-center rounded-xl border border-line bg-[var(--surface-2)] px-3 text-xs font-medium text-ink transition hover:border-[var(--neg)]/50 hover:text-neg"
            >
              Sair
            </button>
          </div>
        </header>

        {/* Topbar no Desktop */}
        <div className="hidden items-center justify-between px-6 pt-6 pb-2 lg:flex">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{activeTab.label}</h1>
            <p className="text-xs text-mute">{activeTab.sub}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <div className="flex items-center gap-2.5 rounded-2xl bg-card px-3 py-1.5 shadow-[var(--shadow-card)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-accent">
                {initial}
              </span>
              <div className="text-left">
                <p className="max-w-[11rem] truncate text-xs font-medium text-ink">{me.email}</p>
                <p className="text-[11px] text-mute">{me.role === "admin" ? "Admin" : "Equipe"}</p>
              </div>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-24 lg:px-6 lg:py-4 lg:pb-8">
          <div role="tabpanel" id="panel-tarefas" aria-labelledby="tab-tarefas" hidden={tab !== "tarefas"}>{visited.tarefas && <TasksTab />}</div>
          <div role="tabpanel" id="panel-crm" aria-labelledby="tab-crm" hidden={tab !== "crm"}>{visited.crm && <CrmTab />}</div>
          <div role="tabpanel" id="panel-krivo" aria-labelledby="tab-krivo" hidden={tab !== "krivo"}>{visited.krivo && <KrivoTab />}</div>
          <div role="tabpanel" id="panel-clientes" aria-labelledby="tab-clientes" hidden={tab !== "clientes"}>{visited.clientes && <ClientsTab />}</div>
        </main>
      </div>

      {/* Bottom Navigation no Mobile */}
      <div
        role="tablist"
        aria-label="Seções"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {TABS.map((t, i) => {
          const active = tab === t.id;
          const badge = badgeFor(t.id);
          return (
            <button
              key={t.id}
              ref={(el) => { refs.current[t.id] = el; }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative flex min-h-15 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition ${
                active ? "text-accent" : "text-mute hover:text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`h-0.5 w-8 rounded-full transition-opacity ${active ? "bg-[var(--accent)] opacity-100" : "opacity-0"}`}
              />
              <span className={`relative rounded-xl px-3 py-1 transition ${active ? "bg-[var(--accent)] text-white shadow-sm" : ""}`}>
                <TabIcon id={t.id} />
                {badge > 0 && (
                  <span
                    aria-hidden
                    className={`absolute -top-0.5 right-0.5 h-2 w-2 rounded-full ${
                      t.id === "crm" ? "bg-[var(--neg)]" : "bg-[var(--accent)]"
                    }`}
                  />
                )}
              </span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
