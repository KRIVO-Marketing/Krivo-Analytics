// Painel de métricas KRIVO: raiz da aplicação (abas KRIVO e Clientes).
"use client";
import { useRef, useState } from "react";
import { useMe } from "./AuthGate";
import ClientsTab from "./ClientsTab";
import CrmTab from "./CrmTab";
import KrivoTab from "./KrivoTab";
import TasksTab from "./TasksTab";
import Logo from "./Logo";

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
        <div className="mx-auto max-w-6xl px-4 py-3 sm:py-10">
          <div className="flex items-start justify-between gap-3">
            <Logo className="text-3xl sm:text-5xl" />
            <div className="flex min-w-0 flex-col items-end gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="max-w-[12rem] truncate sm:max-w-xs" title={me.email}>{me.email}</span>
              <button type="button" className="btn" onClick={signOut}>Sair</button>
            </div>
          </div>
          <p className="mt-3 hidden text-base font-light sm:block sm:text-lg">Criando visibilidade em lucratividade</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <div role="tablist" aria-label="Seções" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[var(--page)] pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:mt-6 sm:border-0 sm:border-b sm:bg-transparent sm:pb-0 sm:gap-1">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} onClick={() => select(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={`min-h-14 flex-1 border-t-2 px-2 text-base sm:-mb-px sm:min-h-11 sm:flex-none sm:border-b-2 sm:border-t-0 sm:px-4 ${tab === t.id ? "border-[var(--ink)] font-medium" : "border-transparent text-mute hover:text-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <main className="py-4 pb-24 sm:py-6 sm:pb-6">
          <div role="tabpanel" id="panel-tarefas" aria-labelledby="tab-tarefas" hidden={tab !== "tarefas"}>{visited.tarefas && <TasksTab />}</div>
          <div role="tabpanel" id="panel-crm" aria-labelledby="tab-crm" hidden={tab !== "crm"}>{visited.crm && <CrmTab />}</div>
          <div role="tabpanel" id="panel-krivo" aria-labelledby="tab-krivo" hidden={tab !== "krivo"}>{visited.krivo && <KrivoTab />}</div>
          <div role="tabpanel" id="panel-clientes" aria-labelledby="tab-clientes" hidden={tab !== "clientes"}>{visited.clientes && <ClientsTab />}</div>
        </main>

        <footer className="flex items-center gap-3 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:gap-4 sm:py-10">
          <Logo className="text-xl" />
          <span className="h-px flex-1 bg-[var(--ink)]" aria-hidden />
          <span className="font-light">2026</span>
        </footer>
      </div>
    </>
  );
}
