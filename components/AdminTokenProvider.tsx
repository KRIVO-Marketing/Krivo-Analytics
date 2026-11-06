"use client";
import { useEffect, useRef, useState } from "react";
import { registerTokenPrompt } from "@/lib/api";
import { Modal } from "./ui";

export default function AdminTokenProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<{ message: string } | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((t: string | null) => void) | null>(null);

  useEffect(() => {
    registerTokenPrompt((message) => new Promise((resolve) => {
      resolver.current = resolve;
      setValue("");
      setAsk({ message });
    }));
    return () => registerTokenPrompt(null);
  }, []);

  const done = (t: string | null) => {
    resolver.current?.(t);
    resolver.current = null;
    setAsk(null);
  };

  return (
    <>
      {children}
      {ask && (
        <Modal title="Token de administrador" onClose={() => done(null)} z={80}>
          <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) done(value.trim()); }}>
            <p role="alert" className="mb-3 text-neg">{ask.message}</p>
            <label className="label" htmlFor="admin-token">Digite o token para continuar</label>
            <input id="admin-token" type="password" autoComplete="off" className="field" value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="hint">O token fica só na memória desta página e some ao recarregar.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => done(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={!value.trim()}>Continuar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
