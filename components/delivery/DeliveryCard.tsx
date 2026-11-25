"use client";
import { useProducts } from "@/lib/useProducts";
import { daysUntil, idleDays, isIdle, productByCode, statusOf, termEnd, type DeliverySummary } from "@/lib/delivery";
import { nameOf, type Member } from "@/lib/ops";
import { Avatar, Pill } from "../opsui";

export function ProductChips({ codes }: { codes: string[] }) {
  useProducts();
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((c) => (
        <span key={c} className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-accent">
          {productByCode(c)?.short ?? c}
        </span>
      ))}
    </div>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--grid)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label ?? "Progresso do checklist"}
      >
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-mute tabular-nums">{done} de {total} itens · {pct}%</p>
    </div>
  );
}

export function TermBadge({ startedAt, months }: { startedAt: string; months: number }) {
  const end = termEnd(startedAt, months);
  const left = daysUntil(end);
  const text = left > 0 ? `${left} dia${left === 1 ? "" : "s"} para o fim da fidelidade` : left === 0 ? "Fidelidade termina hoje" : "Fidelidade mínima cumprida";
  return <span className={`text-xs ${left > 0 && left <= 30 ? "font-medium text-[#b7791f]" : "text-mute"}`}>{text}</span>;
}

export function DeliveryCard({ d, owner, onOpen }: { d: DeliverySummary; owner?: Member; onOpen: () => void }) {
  const st = statusOf(d.status);
  const idle = isIdle(d);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card flex h-full w-full flex-col gap-3 p-4 text-left transition hover:border-[var(--accent)] focus-visible:outline-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink">{d.title}</h3>
          {d.contact_company && d.contact_name && d.contact_company !== d.title && <p className="truncate text-xs text-mute">{d.contact_name}</p>}
        </div>
        {st && <Pill color={st.color}>{st.label}</Pill>}
      </div>
      <ProductChips codes={d.product_codes} />
      <ProgressBar done={d.done} total={d.total} label={`Progresso de ${d.title}`} />
      <div className="space-y-1 text-sm">
        <p className="text-mute">
          {d.current_phase ? <>Fase {d.current_phase.phase}: <span className="text-ink">{d.current_phase.title}</span></> : "Checklist completo"}
          {d.status_detail ? <> · {d.status_detail}</> : null}
        </p>
        <TermBadge startedAt={d.started_at} months={d.min_term_months} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {owner ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-mute"><Avatar m={owner} size={22} />{nameOf(owner)}</span>
        ) : (
          <span className="text-xs text-mute">Sem responsável</span>
        )}
        {d.overdue > 0 && (
          <span className="rounded-full bg-[var(--neg-soft)] px-2 py-0.5 text-[11px] font-medium text-neg">
            {d.overdue} atrasado{d.overdue === 1 ? "" : "s"}
          </span>
        )}
        {idle && (
          <span className="rounded-full bg-[#b7791f]/15 px-2 py-0.5 text-[11px] font-medium text-[#b7791f]">
            Sem interação há {idleDays(d.last_interaction_at)} dias
          </span>
        )}
      </div>
    </button>
  );
}
