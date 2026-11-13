"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ddmm, num } from "@/lib/format";
import type { Metrics } from "@/lib/types";

const H = 240, ML = 44, MR = 12, MT = 16, MB = 28;

function niceMax(v: number) {
  const raw = Math.max(v, 4) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p * 4;
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export type SeriesKey = "sessions" | "users" | "pageviews";
const NAMES: Record<SeriesKey, string> = { sessions: "sessões", users: "visitantes", pageviews: "páginas vistas" };

export default function LineChart({ daily, series = "sessions" }: { daily: Metrics["daily"]; series?: SeriesKey }) {
  const wrap = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const n = daily.length;
  const max = niceMax(Math.max(0, ...daily.map((d) => d[series])));
  const iw = w - ML - MR, ih = H - MT - MB;
  const x = (i: number) => ML + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => MT + ih - (v / max) * ih;
  const pts = daily.map((d, i) => ({ x: x(i), y: y(d[series]) }));
  const line = smoothPath(pts);
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${MT + ih}L${x(0).toFixed(1)},${MT + ih}Z` : "";
  const yTicks = [0, 1, 2, 3, 4].map((t) => (max * t) / 4);
  const xTicks = (() => {
    const k = Math.min(n, w < 420 ? 4 : 7);
    if (k <= 1) return n ? [0] : [];
    return Array.from(new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1)))));
  })();

  const peak = daily.reduce((b, d) => (d[series] > b[series] ? d : b), daily[0] ?? { date: "", sessions: 0, users: 0, pageviews: 0, events: 0 });
  const total = daily.reduce((s, d) => s + d[series], 0);
  const alt = n
    ? `Gráfico de linha de ${NAMES[series]} por dia, de ${ddmm(daily[0].date)} a ${ddmm(daily[n - 1].date)}. Total de ${num(total)} ${NAMES[series]}; pico de ${num(peak[series])} em ${ddmm(peak.date)}.`
    : "Gráfico sem dados.";

  const pick = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || !n) return;
    const rel = clientX - r.left;
    const i = n <= 1 ? 0 : Math.round(((rel - ML) / iw) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const d = hover !== null ? daily[hover] : null;
  const tipLeft = d ? Math.min(Math.max(x(hover!) - 84, 0), w - 168) : 0;

  return (
    <div
      ref={wrap}
      className="relative w-full touch-pan-y select-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); }
        if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? n) - 1)); }
        if (e.key === "Escape") setHover(null);
      }}
      onBlur={() => setHover(null)}
    >
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={alt}
        className="block"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={ML} x2={w - MR} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={ML - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">
              {num(Math.round(t * 10) / 10)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="11"
            fill="var(--mute)"
          >
            {ddmm(daily[i].date)}
          </text>
        ))}
        {n > 0 && <path d={area} fill={`url(#${gradId})`} />}
        {n > 0 && <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />}
        {d && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={MT} y2={MT + ih} stroke="var(--mute)" strokeOpacity="0.45" strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={y(d[series])} r="8" fill="var(--chart-line)" fillOpacity="0.18" />
            <circle cx={x(hover!)} cy={y(d[series])} r="4.5" fill="var(--chart-line)" stroke="var(--page)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {d && (
        <div
          className="pointer-events-none absolute top-1 z-10 w-42 rounded-xl border border-line bg-page/95 p-2.5 text-xs text-ink shadow-lg backdrop-blur-md"
          style={{ left: tipLeft }}
          role="status"
        >
          <p className="mb-1.5 font-semibold text-accent">{ddmm(d.date)}</p>
          <p className="flex justify-between text-mute"><span>Sessões</span><b className="text-ink">{num(d.sessions)}</b></p>
          <p className="flex justify-between text-mute"><span>Visitantes</span><b className="text-ink">{num(d.users)}</b></p>
          <p className="flex justify-between text-mute"><span>Páginas vistas</span><b className="text-ink">{num(d.pageviews)}</b></p>
        </div>
      )}
    </div>
  );
}
