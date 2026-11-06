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
    el?.querySelector<HTMLElement>("input,textarea,button,[tabindex]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>("input,textarea,button,a[href],[tabindex]:not([tabindex='-1'])")).filter((x) => !(x as HTMLButtonElement).disabled);
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
    <div className="fixed inset-0 flex items-end justify-center bg-[#223862]/60 p-0 sm:items-center sm:p-4" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-page p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:p-5">
        <h2 className="mb-4 text-xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}
