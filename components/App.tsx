// Painel de métricas KRIVO: raiz da aplicação (abas Tarefas, CRM, KRIVO e Métricas).
"use client";
import { useRef, useState } from "react";
import { useMe } from "./AuthGate";
import ClientsTab from "./ClientsTab";
import CrmTab from "./CrmTab";
import KrivoTab from "./KrivoTab";
import TasksTab from "./TasksTab";
import Logo from "./Logo";

function TabIcon({ id }: { id: TabId }) {
  const props = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
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

const TABS = [
  { id: "tarefas", label: "Tarefas" },
  { id: "crm", label: "CRM" },
  { id: "krivo", label: "KRIVO" },
  { id: "clientes", label: "Métricas" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const { me, signOut } = useMe();
  const [tab, setTab] = useState<TabId>("tarefas");
  const [visited, setVisited] = useState<Record<TabId, boolean>>({ tarefas: true, crm: false, krivo: false, clientes: false });
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: TabId) => {
    setTab(id);
    setVisited((v) => ({ ...v, [id]: true }));
    refs.current[id]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") select(TABS[(i + 1) % TABS.length].id);
    if (e.key === "ArrowLeft") select(TABS[(i + TABS.length - 1) % TABS.length].id);
  };

  return (
    <>
      <header className="brand-band">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:py-8">
          <div className="flex items-center justify-between gap-3">
            <Logo className="text-2xl sm:text-5xl" />
            <div className="flex min-w-0 items-center gap-2 text-xs sm:gap-3 sm:text-sm">
              <span className="max-w-[9.5rem] truncate opacity-90 sm:max-w-xs" title={me.email}>{me.email}</span>
              <button type="button" onClick={signOut}
                className="inline-flex min-h-9 items-center rounded-xl border border-white/30 px-3 text-white transition hover:bg-white/15 sm:min-h-10 sm:px-4">
                Sair
              </button>
            </div>
          </div>
          <p className="mt-2.5 hidden text-base font-light opacity-90 sm:block sm:text-lg">Criando visibilidade em lucratividade</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <div
          role="tablist"
          aria-label="Seções"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-[var(--page)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:static sm:z-auto sm:mt-5 sm:flex sm:gap-1 sm:border-0 sm:border-b sm:bg-transparent sm:pb-0 sm:backdrop-blur-none"
        >
          {TABS.map((t, i) => {
            const active = tab === t.id;
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
                className={`relative flex min-h-15 flex-col items-center justify-center gap-1 px-1 py-1.5 text-xs transition sm:-mb-px sm:min-h-11 sm:flex-row sm:gap-2 sm:border-b-2 sm:px-4 sm:py-0 sm:text-[0.9375rem] ${
                  active
                    ? "text-[var(--ink)] font-medium sm:border-[var(--ink)]"
                    : "text-mute hover:text-ink sm:border-transparent"
                }`}
              >
                <span aria-hidden className={`h-0.5 w-8 rounded-full transition-opacity sm:hidden ${active ? "bg-[var(--accent)] opacity-100" : "opacity-0"}`} />
                <span className={`rounded-xl px-3 py-1 transition sm:rounded-none sm:bg-transparent sm:p-0 ${active ? "bg-[var(--accent-soft)] text-accent sm:text-ink" : ""}`}>
                  <TabIcon id={t.id} />
                </span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <main className="py-4 pb-24 sm:py-6 sm:pb-6">
          <div role="tabpanel" id="panel-tarefas" aria-labelledby="tab-tarefas" hidden={tab !== "tarefas"}>{visited.tarefas && <TasksTab />}</div>
          <div role="tabpanel" id="panel-crm" aria-labelledby="tab-crm" hidden={tab !== "crm"}>{visited.crm && <CrmTab />}</div>
          <div role="tabpanel" id="panel-krivo" aria-labelledby="tab-krivo" hidden={tab !== "krivo"}>{visited.krivo && <KrivoTab />}</div>
          <div role="tabpanel" id="panel-clientes" aria-labelledby="tab-clientes" hidden={tab !== "clientes"}>{visited.clientes && <ClientsTab />}</div>
        </main>

        <footer className="flex items-center gap-3 py-8 pb-[max(5.5rem,env(safe-area-inset-bottom))] sm:gap-4 sm:py-10 sm:pb-10">
          <Logo className="text-xl" />
          <span className="h-px flex-1 bg-[var(--ink)]" aria-hidden />
          <span className="font-light">2026</span>
        </footer>
      </div>
    </>
  );
}
