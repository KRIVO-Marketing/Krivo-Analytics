"use client";
import { useEffect, useMemo, useState } from "react";
import { getCached, subscribeCache } from "@/lib/cache";
import { CACHE_KEYS, fetchContacts, fetchTasks } from "@/lib/data";
import { brl, dueInfo, nameOf, STAGES, TASK_STATUS, todayISO, type Contact, type Task } from "@/lib/ops";
import { useMe } from "../AuthGate";
import { useTeam } from "../opsui";
import { ChatPanel } from "./ChatPanel";

type Go = (tab: "tarefas" | "crm") => void;

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: string | number; hint?: string; tone?: "neg" | "pos"; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs text-mute">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-mute">{hint}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-4 text-left transition hover:border-[var(--accent)]">{body}</button>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

function BarRow({ label, value, max, color, extra }: { label: string; value: number; max: number; color: string; extra?: string }) {
  return (
    <li className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-mute" title={label}>{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-[var(--grid)]" aria-hidden>
        <span className="block h-full rounded-full transition-all" style={{ width: `${max ? Math.max(value ? 4 : 0, (value / max) * 100) : 0}%`, background: color }} />
      </span>
      <span className="min-w-8 text-right tabular-nums text-ink">{value}{extra && <span className="ml-1 text-[11px] text-mute">{extra}</span>}</span>
    </li>
  );
}

export default function HomeTab({ go }: { go: Go }) {
  const { me } = useMe();
  const team = useTeam();
  const [tasks, setTasks] = useState<Task[]>(() => getCached<Task[]>(CACHE_KEYS.tasks) ?? []);
  const [contacts, setContacts] = useState<Contact[]>(() => getCached<Contact[]>(CACHE_KEYS.contacts) ?? []);
  const [loading, setLoading] = useState(() => getCached<Task[]>(CACHE_KEYS.tasks) === undefined || getCached<Contact[]>(CACHE_KEYS.contacts) === undefined);

  useEffect(() => {
    let live = true;
    const u1 = subscribeCache(CACHE_KEYS.tasks, () => live && setTasks(getCached<Task[]>(CACHE_KEYS.tasks) ?? []));
    const u2 = subscribeCache(CACHE_KEYS.contacts, () => live && setContacts(getCached<Contact[]>(CACHE_KEYS.contacts) ?? []));
    Promise.all([fetchTasks(), fetchContacts()])
      .then(([t, c]) => { if (live) { setTasks(t); setContacts(c); } })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => { live = false; u1(); u2(); };
  }, []);

  const today = todayISO();
  const d = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "concluida");
    const overdue = open.filter((t) => t.due_date && t.due_date < today);
    const dueToday = open.filter((t) => t.due_date === today);
    const mine = open.filter((t) => t.assignee_id === me.id);
    const active = contacts.filter((c) => c.stage !== "fechado" && c.stage !== "perdido");
    const followUps = active.filter((c) => c.next_contact_at && c.next_contact_at <= today);
    const pipeline = active.reduce((a, c) => a + (Number(c.value) || 0), 0);
    const won = contacts.filter((c) => c.stage === "fechado").reduce((a, c) => a + (Number(c.value) || 0), 0);

    const statusRows = TASK_STATUS.map((s) => ({ ...s, n: tasks.filter((t) => t.status === s.id).length }));
    const stageRows = STAGES.map((s) => ({ ...s, n: contacts.filter((c) => c.stage === s.id).length }));

    // Concluídas por dia (últimos 7 dias)
    const days = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(); dt.setDate(dt.getDate() - (6 - i));
      const key = localDay(dt.toISOString());
      return { key, label: dt.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""), n: 0 };
    });
    for (const t of tasks) {
      if (t.status === "concluida" && t.completed_at) {
        const row = days.find((x) => x.key === localDay(t.completed_at!));
        if (row) row.n++;
      }
    }
    const urgent = [...overdue, ...dueToday].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 5);
    const returns = [...followUps].sort((a, b) => (a.next_contact_at ?? "").localeCompare(b.next_contact_at ?? "")).slice(0, 5);
    return { open, overdue, dueToday, mine, active, followUps, pipeline, won, statusRows, stageRows, days, urgent, returns };
  }, [tasks, contacts, me.id, today]);

  const firstName = (me.name || me.email.split("@")[0]).split(/[\s._]/)[0];
  const cap = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const dateLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const byId = new Map(team.map((m) => [m.id, m]));
  const maxStatus = Math.max(1, ...d.statusRows.map((r) => r.n));
  const maxStage = Math.max(1, ...d.stageRows.map((r) => r.n));
  const maxDay = Math.max(1, ...d.days.map((x) => x.n));
  const doneWeek = d.days.reduce((a, x) => a + x.n, 0);

  if (loading) return <div className="skeleton h-72" aria-busy="true" aria-label="Carregando a home" />;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="order-2 space-y-5 lg:order-1">
        <div className="hidden lg:block">
          <p className="text-sm text-mute first-letter:uppercase">{dateLabel}</p>
          <h2 className="text-xl font-semibold text-ink">{hello}, {cap}.</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi label="Tarefas abertas" value={d.open.length} hint={`${d.mine.length} com você`} onClick={() => go("tarefas")} />
          <Kpi label="Atrasadas" value={d.overdue.length} hint={d.dueToday.length ? `${d.dueToday.length} vencem hoje` : "nenhuma vence hoje"} tone={d.overdue.length ? "neg" : "pos"} onClick={() => go("tarefas")} />
          <Kpi label="Retornos no CRM" value={d.followUps.length} hint="vencidos ou de hoje" tone={d.followUps.length ? "neg" : undefined} onClick={() => go("crm")} />
          <Kpi label="Em negociação" value={brl(d.pipeline) || "R$ 0,00"} hint={d.won ? `${brl(d.won)} fechado` : `${d.active.length} contatos ativos`} onClick={() => go("crm")} />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card p-4 sm:p-5" aria-label="Tarefas por status">
            <h3 className="mb-3 text-sm font-semibold text-ink">Tarefas por status</h3>
            <ul className="space-y-3">
              {d.statusRows.map((r) => <BarRow key={r.id} label={r.label} value={r.n} max={maxStatus} color={r.color} />)}
            </ul>
          </section>

          <section className="card p-4 sm:p-5" aria-label="Funil do CRM">
            <h3 className="mb-3 text-sm font-semibold text-ink">Funil do CRM</h3>
            <ul className="space-y-2.5">
              {d.stageRows.map((r) => <BarRow key={r.id} label={r.label} value={r.n} max={maxStage} color={r.color} />)}
            </ul>
          </section>
        </div>

        <section className="card p-4 sm:p-5" aria-label="Tarefas concluídas nos últimos 7 dias">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-ink">Concluídas nos últimos 7 dias</h3>
            <span className="text-xs text-mute tabular-nums">{doneWeek} no total</span>
          </div>
          <div className="flex h-28 items-end gap-2" role="img" aria-label={`Tarefas concluídas por dia: ${d.days.map((x) => `${x.label} ${x.n}`).join(", ")}`}>
            {d.days.map((x) => (
              <div key={x.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] tabular-nums text-mute">{x.n || ""}</span>
                <span className="w-full max-w-9 rounded-t-lg bg-[var(--accent)]" style={{ height: `${Math.max(x.n ? 8 : 3, (x.n / maxDay) * 72)}%`, opacity: x.n ? 1 : 0.25 }} />
                <span className="text-[11px] text-mute">{x.label}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card p-4 sm:p-5" aria-label="Prioridades de hoje">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Para resolver hoje</h3>
              <button type="button" className="text-xs text-accent" onClick={() => go("tarefas")}>Ver tarefas</button>
            </div>
            {d.urgent.length === 0 ? (
              <p className="py-3 text-sm text-mute">Nada atrasado nem vencendo hoje. 🎉</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.urgent.map((t) => {
                  const due = dueInfo(t.due_date);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate text-ink">{t.title}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        {t.assignee_id && <span className="text-mute">{nameOf(byId.get(t.assignee_id))}</span>}
                        <span className={due?.late ? "font-medium text-neg" : "text-mute"}>{due?.text}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card p-4 sm:p-5" aria-label="Retornos do CRM">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Retornar contato</h3>
              <button type="button" className="text-xs text-accent" onClick={() => go("crm")}>Ver CRM</button>
            </div>
            {d.returns.length === 0 ? (
              <p className="py-3 text-sm text-mute">Nenhum retorno pendente.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.returns.map((c) => {
                  const due = dueInfo(c.next_contact_at);
                  const st = STAGES.find((s) => s.id === c.stage);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{c.name}{c.company ? ` · ${c.company}` : ""}</span>
                        <span className="text-xs text-mute">{st?.label}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${due?.late ? "font-medium text-neg" : "text-mute"}`}>{due?.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="order-1 lg:sticky lg:top-4 lg:order-2">
        <ChatPanel firstName={cap} />
      </div>
    </div>
  );
}
