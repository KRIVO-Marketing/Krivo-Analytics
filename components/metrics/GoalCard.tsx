"use client";
import { useCallback, useEffect, useState } from "react";
import { apiWrite } from "@/lib/api";
import { getCached } from "@/lib/cache";
import { CACHE_KEYS, fetchGoals } from "@/lib/data";
import { brl, parseBrl } from "@/lib/format";
import type { Goal } from "@/lib/types";
import { useMe } from "../AuthGate";
import { IconCheck } from "../Icons";
import { ErrorBox, Modal } from "../ui";

type Mode = "profit" | "new" | "edit" | null;

function GoalForm({ mode, goal, onClose, onSaved }: { mode: Exclude<Mode, null>; goal?: Goal; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(mode === "new" ? "" : goal?.title ?? "");
  const [target, setTarget] = useState(mode === "new" ? "" : String(goal?.target ?? "").replace(".", ","));
  const [current, setCurrent] = useState(mode === "new" ? "0" : String(goal?.current ?? "0").replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "profit") await apiWrite({ action: "goal_update", id: goal!.id, current: parseBrl(current) });
      else if (mode === "edit") await apiWrite({ action: "goal_update", id: goal!.id, title, target: parseBrl(target), current: parseBrl(current) });
      else await apiWrite({ action: "goal_create", title, target: parseBrl(target), current: parseBrl(current) });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === "profit" ? "Atualizar lucro atual" : mode === "edit" ? "Editar meta" : "Nova meta";
  return (
    <Modal title={heading} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        {mode !== "profit" && (
          <>
            <div>
              <label className="label" htmlFor="g-title">Nome da meta</label>
              <input id="g-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Lucro de dezembro" />
            </div>
            <div>
              <label className="label" htmlFor="g-target">Valor da meta (R$)</label>
              <input id="g-target" className="field" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10.000,00" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="g-current">Lucro atual (R$)</label>
          <input id="g-current" className="field" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0,00" />
          {mode === "profit" && <p className="hint">Digite o total acumulado até agora, não só o que entrou hoje.</p>}
        </div>
        {err && <p role="alert" className="rounded-xl border border-neg/50 p-3 text-neg">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (mode !== "profit" && !title.trim())}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function GoalCard() {
  const canEdit = useMe().me.role === "admin"; // só esconde botões; quem recusa é o back-end
  const [goals, setGoals] = useState<Goal[] | null>(() => getCached<Goal[]>(CACHE_KEYS.goals) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      setGoals(await fetchGoals(force));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox message={error} onRetry={() => load(true)} />;
  if (!goals) return <div className="skeleton h-40" aria-busy="true" aria-label="Carregando meta" />;

  const goal = goals[0];
  const past = goals.slice(1);
  const saved = () => {
    setMode(null);
    load(true);
  };

  if (!goal) {
    return (
      <section className="card p-5" aria-label="Meta de lucro">
        <h2 className="text-xl">Meta de lucro</h2>
        <p className="mt-1 text-mute">Nenhuma meta definida ainda.</p>
        {canEdit && <button type="button" className="btn btn-primary mt-4" onClick={() => setMode("new")}>Definir meta</button>}
        {mode === "new" && <GoalForm mode="new" onClose={() => setMode(null)} onSaved={saved} />}
      </section>
    );
  }

  const target = Number(goal.target);
  const current = Number(goal.current);
  const pct = Math.min(100, Math.floor((current / target) * 100));
  const done = !!goal.achieved_at;

  return (
    <section className="card p-4 sm:p-5" aria-label="Meta de lucro">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-mute">Meta de lucro</p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                done ? "bg-[color-mix(in_srgb,var(--pos)_15%,transparent)] text-pos" : "bg-[var(--accent-soft)] text-accent"
              }`}
            >
              {pct}%
            </span>
          </div>
          <h2 className="mt-0.5 text-xl font-normal">{goal.title}</h2>
        </div>
        {canEdit && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {!done && (
              <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={() => setMode("profit")}>
                Atualizar lucro
              </button>
            )}
            <button type="button" className="btn flex-1 sm:flex-none" onClick={() => setMode("edit")}>Editar</button>
            <button type="button" className="btn flex-1 sm:flex-none" onClick={() => setMode("new")}>Nova meta</button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-3xl font-semibold tracking-tight text-accent sm:text-4xl">{brl(current)}</p>
        <p className="text-sm text-mute sm:text-base">de {brl(target)}</p>
      </div>
      <div
        className="mt-2.5 h-3.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--grid)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Progresso da meta: ${pct}%`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%`, background: done ? "var(--pos)" : "var(--accent)" }}
        />
      </div>
      <p className="mt-2.5 text-sm" role="status">
        {done ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-pos">
            <IconCheck size={15} />
            Meta batida! Parabéns!
          </span>
        ) : (
          <span className="text-mute">
            Faltam <b className="font-medium text-ink">{brl(Math.max(0, target - current))}</b> para bater a meta
          </span>
        )}
      </p>

      {past.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <button type="button" className="text-sm text-mute underline" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Esconder metas anteriores" : `Ver metas anteriores (${past.length})`}
          </button>
          {showPast && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {past.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${g.achieved_at ? "bg-[var(--pos)]" : "bg-[var(--soft)]"}`} aria-hidden />
                    {g.title}
                  </span>
                  <span className="text-mute">{brl(Number(g.current))} / {brl(Number(g.target))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {mode && <GoalForm mode={mode} goal={goal} onClose={() => setMode(null)} onSaved={saved} />}
    </section>
  );
}
