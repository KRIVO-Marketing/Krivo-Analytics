"use client";
import { useRef, useState } from "react";
import AdminTokenProvider from "./AdminTokenProvider";
import ClientsTab from "./ClientsTab";
import KrivoTab from "./KrivoTab";
import Logo from "./Logo";

const TABS = [{ id: "krivo", label: "KRIVO" }, { id: "clientes", label: "Clientes" }] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("krivo");
  const [visited, setVisited] = useState({ krivo: true, clientes: false });
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: (typeof TABS)[number]["id"]) => {
    setTab(id);
    setVisited((v) => ({ ...v, [id]: true }));
    refs.current[id]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") select(TABS[(i + 1) % TABS.length].id);
    if (e.key === "ArrowLeft") select(TABS[(i + TABS.length - 1) % TABS.length].id);
  };

  return (
    <AdminTokenProvider>
      <header className="brand-band">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
          <Logo className="text-4xl sm:text-5xl" />
          <p className="mt-3 text-base font-light sm:text-lg">Criando visibilidade em lucratividade</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        <div role="tablist" aria-label="Seções" className="mt-4 flex border-b border-line sm:mt-6 sm:gap-1">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} onClick={() => select(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={`-mb-px min-h-12 flex-1 border-b-2 px-4 text-base sm:min-h-11 sm:flex-none ${tab === t.id ? "border-[var(--ink)] font-medium" : "border-transparent text-mute hover:text-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <main className="py-4 sm:py-6">
          <div role="tabpanel" id="panel-krivo" aria-labelledby="tab-krivo" hidden={tab !== "krivo"}>{visited.krivo && <KrivoTab />}</div>
          <div role="tabpanel" id="panel-clientes" aria-labelledby="tab-clientes" hidden={tab !== "clientes"}>{visited.clientes && <ClientsTab />}</div>
        </main>

        <footer className="flex items-center gap-3 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:gap-4 sm:py-10">
          <Logo className="text-xl" />
          <span className="h-px flex-1 bg-[var(--ink)]" aria-hidden />
          <span className="font-light">2026</span>
        </footer>
      </div>
    </AdminTokenProvider>
  );
}
