"use client";
import { useEffect, useRef, useState } from "react";
import { brl } from "@/lib/format";
import { monthShort, type MonthPoint } from "@/lib/finance";

const H = 220, ML = 52, MR = 10, MT = 14, MB = 26;
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

function niceStep(range: number) {
  const raw = Math.max(range, 4) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
// Eixo com 4 intervalos que sempre inclui o zero (aceita valores negativos).
function axis(min: number, max: number) {
  const step = niceStep(Math.max(max - Math.min(min, 0), 1));
  const lo = Math.min(0, Math.floor(min / step) * step);
  const hi = Math.max(step * 2, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Tip({ x, w, children }: { x: number; w: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x - 80, 0), w - 168);
  return (
    <div className="pointer-events-none absolute top-0 z-10 w-40 rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-[var(--shadow-card)]" style={{ left }}>
      {children}
    </div>
  );
}

// Entradas x saídas realizadas, mês a mês.
export function FlowBars({ series, selected, onSelect }: { series: MonthPoint[]; selected: string; onSelect: (ym: string) => void }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = series.length;
  const max = Math.max(0, ...series.flatMap((p) => [p.in, p.out]));
  const { hi, ticks } = axis(0, max);
  const iw = w - ML - MR, ih = H - MT - MB;
  const slot = iw / n;
  const bw = Math.max(4, Math.min(18, slot / 2 - 3));
  const y = (v: number) => MT + ih - (v / hi) * ih;
  const hp = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={H} role="img" aria-label="Entradas e saídas por mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ML} x2={w - MR} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={ML - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{compact(t)}</text>
          </g>
        ))}
        {series.map((p, i) => {
          const cx = ML + slot * i + slot / 2;
          const on = p.ym === selected;
          return (
            <g key={p.ym} onMouseEnter={() => setHover(i)} onClick={() => onSelect(p.ym)} style={{ cursor: "pointer" }}>
              <rect x={cx - slot / 2} y={MT} width={slot} height={ih + MB} fill={on ? "var(--accent-soft)" : "transparent"} rx="8" />
              <rect x={cx - bw - 1} y={y(p.in)} width={bw} height={Math.max(0, MT + ih - y(p.in))} rx="3" fill="var(--pos)" />
              <rect x={cx + 1} y={y(p.out)} width={bw} height={Math.max(0, MT + ih - y(p.out))} rx="3" fill="var(--neg)" />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fontWeight={on ? 600 : 400} fill={on ? "var(--ink)" : "var(--mute)"}>{monthShort(p.ym)}</text>
            </g>
          );
        })}
      </svg>
      {hp && (
        <Tip x={ML + slot * (hover ?? 0) + slot / 2} w={w}>
          <p className="font-medium text-ink">{monthShort(hp.ym)}/{hp.ym.slice(2, 4)}</p>
          <p className="text-pos">Entradas {brl(hp.in)}</p>
          <p className="text-neg">Saídas {brl(hp.out)}</p>
          <p className="text-ink">Saldo {brl(hp.balance)}</p>
        </Tip>
      )}
    </div>
  );
}

// Saldo acumulado (tudo que já foi pago até o fim de cada mês).
export function CumulativeLine({ series }: { series: MonthPoint[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const vals = series.map((p) => p.cumulative);
  const { lo, hi, ticks } = axis(Math.min(0, ...vals), Math.max(0, ...vals));
  const iw = w - ML - MR, ih = H - MT - MB;
  const n = series.length;
  const x = (i: number) => ML + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => MT + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const hp = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width={w} height={H} role="img" aria-label="Saldo acumulado por mês"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - ML) / (iw || 1)) * (n - 1));
          setHover(Math.min(n - 1, Math.max(0, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ML} x2={w - MR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--soft)" : "var(--grid)"} />
            <text x={ML - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{compact(t)}</text>
          </g>
        ))}
        <path d={area} fill="var(--accent)" opacity="0.1" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => (
          <text key={p.ym} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mute)">{monthShort(p.ym)}</text>
        ))}
        {hover !== null && <circle cx={x(hover)} cy={y(series[hover].cumulative)} r="4.5" fill="var(--accent)" stroke="var(--card)" strokeWidth="2" />}
      </svg>
      {hp && (
        <Tip x={x(hover ?? 0)} w={w}>
          <p className="font-medium text-ink">{monthShort(hp.ym)}/{hp.ym.slice(2, 4)}</p>
          <p className="text-ink">Acumulado {brl(hp.cumulative)}</p>
        </Tip>
      )}
    </div>
  );
}

// Ranking de categorias (barras horizontais com valor e % do total).
export function CategoryBars({ rows, color }: { rows: { id: string; label: string; value: number }[]; color: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = rows[0]?.value || 1;
  if (!rows.length) return <p className="py-6 text-center text-sm text-mute">Nada pago neste mês ainda.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-mute"><span className="font-medium text-ink">{brl(r.value)}</span> · {Math.round((r.value / total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--grid)]">
            <div className="h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
