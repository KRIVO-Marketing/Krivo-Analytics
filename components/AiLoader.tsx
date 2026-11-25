"use client";
import { useEffect, useState } from "react";

type Props = {
  title: string;
  steps?: string[];        // etapas reais (Diagnóstico); sem isso, mostra só o tempo e as dicas
  current?: number;        // índice da etapa em andamento
  note?: string | null;    // aviso pontual (ex.: espera pelo limite da IA)
  tips?: string[];
  compact?: boolean;
};

const DEFAULT_TIPS = [
  "A IA lê os dados públicos e calcula as métricas em código, sem chutar números.",
  "Cada nota vem com o porquê e com ações práticas.",
  "Não feche esta aba: o relatório aparece aqui quando terminar.",
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function AiLoader({ title, steps, current = 0, note, tips = DEFAULT_TIPS, compact = false }: Props) {
  const [sec, setSec] = useState(0);
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (tips.length < 2) return;
    const t = setInterval(() => setTip((i) => (i + 1) % tips.length), 5000);
    return () => clearInterval(t);
  }, [tips.length]);

  return (
    <div className={`ai-loader ${compact ? "ai-loader-compact" : ""}`} role="status" aria-live="polite">
      <div className="ai-orb" aria-hidden>
        <span className="ai-orb-ring" /><span className="ai-orb-ring ai-orb-ring2" /><span className="ai-orb-core" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title} <span className="ai-time tabular-nums">{mmss(sec)}</span></p>
        {steps && (
          <ol className="ai-steps">
            {steps.map((s, i) => (
              <li key={s} data-state={i < current ? "done" : i === current ? "now" : "todo"}>
                <span className="ai-dot" aria-hidden>{i < current ? "✓" : ""}</span>{s}
              </li>
            ))}
          </ol>
        )}
        {note && <p className="ai-note">{note}</p>}
        {!compact && tips.length > 0 && <p className="ai-tip" key={tip}>{tips[tip % tips.length]}</p>}
      </div>
    </div>
  );
}
