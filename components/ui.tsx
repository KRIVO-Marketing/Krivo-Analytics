"use client";
import { useEffect, useRef } from "react";

export function ErrorBox({ message, onRetry, retryLabel = "Tentar de novo" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-neg/50 p-4 text-neg">
      <p className="font-normal">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-danger mt-3" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, z = 50 }: { title: string; onClose: () => void; children: React.ReactNode; z?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("input,select,textarea,button,[tabindex]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>("input,select,textarea,button,a[href],[tabindex]:not([tabindex='-1'])"))
          .filter((x) => !(x as HTMLButtonElement).disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="fixed inset-0 flex items-end justify-center bg-[#0f1b33]/65 backdrop-blur-[2px] p-0 sm:items-center sm:p-4"
      style={{ zIndex: z }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ boxShadow: "var(--shadow-sheet)" }}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-line bg-page sm:rounded-2xl"
      >
        <div className="shrink-0 border-b border-line bg-page/95 px-4 pt-2.5 pb-3 backdrop-blur-sm sm:px-5 sm:pt-3.5">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--soft)]/60 sm:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-lg font-medium sm:text-xl">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-mute transition hover:bg-[var(--accent-soft)] hover:text-ink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
