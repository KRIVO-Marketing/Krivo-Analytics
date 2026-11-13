// Porta de entrada: nada do painel (nem a árvore de componentes, nem requisições) existe antes do login.
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { registerAuthHandlers } from "@/lib/api";
import { getAuth, getSiteUrl, type Me } from "@/lib/auth";
import { invalidateCache } from "@/lib/cache";
import { bootstrapApp } from "@/lib/data";
import Logo from "./Logo";

const MeContext = createContext<{ me: Me; signOut: () => void } | null>(null);
export const useMe = () => useContext(MeContext)!;

type View = "loading" | "login" | "recovery" | "forbidden" | "panel";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const viewRef = useRef<View>("loading");
  const meRef = useRef<Me | null>(null);
  const loadingUserRef = useRef<string | null>(null);
  viewRef.current = view;
  meRef.current = me;

  const signOut = useCallback(() => { void getAuth().signOut(); }, []);

  // Alterna login/painel conforme a sessão. Sem await dentro do callback (evita travar o supabase-js).
  useEffect(() => {
    const { data } = getAuth().onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { setView("recovery"); return; }
      if (event === "SIGNED_OUT" || !session) {
        loadingUserRef.current = null;
        meRef.current = null;
        invalidateCache();
        setMe(null);
        setView("login");
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (viewRef.current === "recovery") return;
        const uid = session.user.id;
        // Evita desmontar o painel e recarregar tudo quando o supabase-js reemite SIGNED_IN ao voltar para a aba.
        if (viewRef.current === "panel" && meRef.current?.id === uid) return;
        if (loadingUserRef.current === uid) return;
        if (meRef.current && meRef.current.id !== uid) {
          invalidateCache();
          meRef.current = null;
          setMe(null);
        }
        loadingUserRef.current = uid;
        setView("loading");
        setTimeout(() => loadMe(uid), 0);
      }
    });
    registerAuthHandlers({
      onExpired: () => {
        invalidateCache();
        setNotice("Sua sessão expirou. Entre novamente.");
        void getAuth().signOut();
      },
      onForbidden: () => {
        loadingUserRef.current = null;
        meRef.current = null;
        invalidateCache();
        setMe(null);
        setView("forbidden");
      },
    });
    return () => { data.subscription.unsubscribe(); registerAuthHandlers(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMe(expectedUserId?: string) {
    try {
      const user = await bootstrapApp();
      if (expectedUserId && loadingUserRef.current !== expectedUserId) return;
      meRef.current = user;
      setMe(user);
      setView((v) => (v === "recovery" ? v : "panel"));
    } catch {
      /* 401/403 já tratados pelos handlers; outros erros: volta ao login sem expor detalhes */
      if (!expectedUserId || loadingUserRef.current === expectedUserId) {
        setView((v) => (v === "forbidden" || v === "login" ? v : "login"));
      }
    } finally {
      if (!expectedUserId || loadingUserRef.current === expectedUserId) {
        loadingUserRef.current = null;
      }
    }
  }

  if (view === "loading") return <Shell><p className="text-mute" aria-busy="true">Carregando…</p></Shell>;
  if (view === "recovery") return <NewPassword onDone={() => { setNotice(null); setView("loading"); loadMe(); }} onCancel={signOut} />;
  if (view === "forbidden") {
    return (
      <Shell>
        <h1 className="text-2xl">Seu usuário não tem acesso a esta plataforma</h1>
        <button type="button" className="btn btn-primary mt-6 w-full" onClick={signOut}>Sair</button>
      </Shell>
    );
  }
  if (view === "login" || !me) return <Login notice={notice} onClearNotice={() => setNotice(null)} />;
  return <MeContext.Provider value={{ me, signOut }}>{children}</MeContext.Provider>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mb-6 block text-4xl sm:text-5xl" />
        <div className="card p-6 sm:p-7">{children}</div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, label }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} type={show ? "text" : "password"} className="field min-w-0 flex-1" value={value} maxLength={128} required
          autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn" aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? "Ocultar" : "Mostrar"}</button>
      </div>
    </>
  );
}

function Login({ notice, onClearNotice }: { notice: string | null; onClearNotice: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null); onClearNotice();
    const { error } = await getAuth().signInWithPassword({ email: email.trim(), password });
    if (error) { setError("E-mail ou senha incorretos."); setPassword(""); }
    setBusy(false);
  };

  const forgot = async () => {
    setError(null); setInfo(null);
    if (!email.trim()) { setError("Digite seu e-mail para receber o link."); return; }
    setBusy(true);
    await getAuth().resetPasswordForEmail(email.trim(), { redirectTo: getSiteUrl() });
    setBusy(false);
    // Resposta sempre igual: não revela se o e-mail existe.
    setInfo("Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.");
  };

  return (
    <Shell>
      <h1 className="mb-1 text-2xl">Entrar</h1>
      <p className="mb-6 font-light text-mute">Painel de métricas</p>
      <form onSubmit={submit} noValidate={false}>
        {notice && <p role="alert" className="mb-4 rounded-xl border border-neg/50 p-3 text-neg">{notice}</p>}
        <label className="label" htmlFor="login-email">E-mail</label>
        <input id="login-email" type="email" className="field" value={email} maxLength={254} required autoComplete="username" inputMode="email"
          onChange={(e) => setEmail(e.target.value)} />
        <div className="mt-4"><PasswordInput id="login-senha" label="Senha" value={password} onChange={setPassword} autoComplete="current-password" /></div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-neg/50 p-3 text-neg">{error}</p>}
        {info && <p role="status" className="mt-4 rounded-xl border border-line p-3">{info}</p>}
        <button type="submit" className="btn btn-primary mt-6 w-full" disabled={busy || !email.trim() || !password}>{busy ? "Aguarde…" : "Entrar"}</button>
        <button type="button" className="mt-4 w-full text-center underline" onClick={forgot} disabled={busy}>Esqueci minha senha</button>
      </form>
    </Shell>
  );
}

function NewPassword({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setError("As senhas não são iguais."); return; }
    setBusy(true); setError(null);
    const { error } = await getAuth().updateUser({ password: pw });
    setBusy(false);
    if (error) { setError(error.message || "Não foi possível definir a nova senha. Tente de novo."); return; } // a regra de força da senha é do Supabase Auth
    onDone();
  };

  return (
    <Shell>
      <h1 className="mb-6 text-2xl">Definir nova senha</h1>
      <form onSubmit={submit}>
        <PasswordInput id="nova-senha" label="Nova senha" value={pw} onChange={setPw} autoComplete="new-password" />
        <div className="mt-4"><PasswordInput id="nova-senha2" label="Confirmar nova senha" value={pw2} onChange={setPw2} autoComplete="new-password" /></div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-neg/50 p-3 text-neg">{error}</p>}
        <button type="submit" className="btn btn-primary mt-6 w-full" disabled={busy || !pw || !pw2}>{busy ? "Aguarde…" : "Salvar nova senha"}</button>
        <button type="button" className="btn mt-3 w-full" onClick={onCancel} disabled={busy}>Cancelar</button>
      </form>
    </Shell>
  );
}
