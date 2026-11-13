"use client";
import { useCallback, useEffect, useState } from "react";
import { opsCall } from "@/lib/api";
import { CACHE_KEYS, fetchTeam } from "@/lib/data";
import { setCached } from "@/lib/cache";
import { initial, nameOf, type Member } from "@/lib/ops";
import { useMe } from "./AuthGate";
import { ErrorBox } from "./ui";

type InviteResult = {
  email: string;
  name: string;
  tempPassword: string;
  emailSent: boolean;
  emailWarning?: string;
};

export default function TeamTab() {
  const { me } = useMe();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const list = await fetchTeam(force);
      setMembers(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setInviteInfo(null);
    try {
      const r = await opsCall<{
        member: Member;
        tempPassword: string;
        emailSent: boolean;
        emailWarning?: string;
      }>({ action: "team_invite", name: name.trim(), email: email.trim() });
      const next = [...members.filter((m) => m.id !== r.member.id), r.member];
      setMembers(next);
      setCached(CACHE_KEYS.team, next);
      setInviteInfo({
        email: r.member.email,
        name: nameOf(r.member),
        tempPassword: r.tempPassword,
        emailSent: r.emailSent,
        emailWarning: r.emailWarning,
      });
      setName("");
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (m: Member) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await opsCall<{ emailSent: boolean; emailWarning?: string }>({
        action: "team_resend_reset",
        id: m.id,
      });
      setNotice(
        r.emailSent
          ? `Link de redefinição reenviado para ${m.email}.`
          : r.emailWarning ?? `Não foi possível enviar o e-mail para ${m.email}.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await opsCall({ action: "team_remove", id });
      const next = members.filter((m) => m.id !== id);
      setMembers(next);
      setCached(CACHE_KEYS.team, next);
      setConfirmRemove(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="skeleton h-64" aria-busy="true" aria-label="Carregando equipe" />;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="text-base font-semibold text-ink">Adicionar sócio / usuário</h2>
        <p className="mt-1 text-xs text-mute">
          Cria o login individual como administrador, gera uma senha temporária de primeiro acesso e envia o link de redefinição via Resend.
        </p>

        <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="team-name">Nome</label>
            <input
              id="team-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Gustavo"
              minLength={2}
              maxLength={80}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="team-email">E-mail</label>
            <input
              id="team-email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="socio@krivomkt.com.br"
              maxLength={254}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !email.trim()}>
            {busy ? "Enviando…" : "+ Cadastrar e enviar"}
          </button>
        </form>

        {inviteInfo && (
          <div className="mt-4 rounded-xl border border-line bg-[var(--surface-2)] p-3.5 text-xs">
            <p className="font-medium text-ink">
              Acesso criado para <b>{inviteInfo.name}</b> ({inviteInfo.email}).
            </p>
            <p className="mt-1 text-mute">
              Senha temporária (1º login):{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-semibold text-ink">{inviteInfo.tempPassword}</code>
            </p>
            <p className={`mt-1 ${inviteInfo.emailSent ? "text-pos" : "text-neg"}`}>
              {inviteInfo.emailSent
                ? "✓ E-mail com link de redefinição enviado via Resend."
                : `⚠ ${inviteInfo.emailWarning ?? "Não foi possível enviar o e-mail pela Resend."}`}
            </p>
          </div>
        )}
      </section>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}
      {notice && (
        <p role="status" className="rounded-xl border border-line bg-card px-4 py-2.5 text-xs text-ink">
          {notice}
        </p>
      )}

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Sócios cadastrados</h2>
          <span className="rounded-full bg-[var(--grid)] px-2.5 py-0.5 text-xs font-medium text-mute tabular-nums">
            {members.length}
          </span>
        </div>
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const isMe = m.id === me.id;
            return (
              <li key={m.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-accent">
                    {initial(m)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {nameOf(m)}
                      {isMe && <span className="ml-1.5 text-xs font-normal text-mute">(você)</span>}
                    </p>
                    <p className="truncate text-xs text-mute">{m.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      m.must_reset_password
                        ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent"
                        : "bg-[color-mix(in_srgb,var(--pos)_14%,transparent)] text-pos"
                    }`}
                  >
                    {m.must_reset_password ? "Aguardando 1º acesso" : "Ativo"}
                  </span>
                  <button type="button" className="btn min-h-8 px-3 text-xs" onClick={() => resend(m)} disabled={busy}>
                    Reenviar link
                  </button>
                  {!isMe &&
                    (confirmRemove === m.id ? (
                      <div className="flex gap-1.5">
                        <button type="button" className="btn btn-danger min-h-8 px-3 text-xs" onClick={() => remove(m.id)} disabled={busy}>
                          Confirmar
                        </button>
                        <button type="button" className="btn min-h-8 px-2.5 text-xs" onClick={() => setConfirmRemove(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn min-h-8 px-3 text-xs text-neg" onClick={() => setConfirmRemove(m.id)} disabled={busy}>
                        Remover
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
