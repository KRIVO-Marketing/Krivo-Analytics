"use client";
import { useState } from "react";
import { opsCall } from "@/lib/api";
import { brl, hasAnyPrice, type CatalogItem } from "@/lib/ops";
import { FormError } from "../opsui";
import { Modal } from "../ui";

type Props = {
  item: CatalogItem;
  onClose: () => void;
  onEdit: (item: CatalogItem) => void;
  onDeleted: (id: string) => void;
};

function PriceBox({ label, value, suffix }: { label: string; value: number | string | null; suffix?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-line p-3.5">
      <p className="text-xs text-mute">{label}</p>
      {value != null ? (
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">
          {brl(value)}
          {suffix && <span className="text-sm font-normal text-mute">{suffix}</span>}
        </p>
      ) : (
        <p className="mt-0.5 text-base text-mute">A definir</p>
      )}
    </div>
  );
}

export function ItemSheet({ item, onClose, onEdit, onDeleted }: Props) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isProduct = item.kind === "product";

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await opsCall({ action: "catalog_delete", id: item.id });
      onDeleted(item.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item.name} onClose={() => !busy && onClose()}>
      <div className="space-y-5">
        {isProduct && (
          <div>
            {(item.code || item.tagline || item.billing) && (
              <p className="text-sm text-mute">
                {[item.code && `Nº ${item.code}`, item.tagline, item.billing].filter(Boolean).join(" · ")}
              </p>
            )}
            {(item.upfront_label || item.has_monthly) && (
              <div className="mt-3 flex gap-2">
                {item.upfront_label && <PriceBox label={item.upfront_label} value={item.price_upfront} />}
                {item.has_monthly && <PriceBox label="Mensalidade" value={item.price_monthly} suffix="/mês" />}
              </div>
            )}
            {!hasAnyPrice(item) && (item.upfront_label || item.has_monthly) && (
              <p className="hint">Preço ainda não definido. Toque em Editar para preencher.</p>
            )}
          </div>
        )}

        {item.summary && <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed">{item.summary}</p>}

        {isProduct && item.details.length > 0 && (
          <dl className="divide-y divide-line rounded-2xl border border-line">
            {item.details.map((d, i) => (
              <div key={i} className="p-3.5">
                <dt className="text-xs font-medium uppercase tracking-wider text-mute">{d.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{d.text}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="text-xs text-mute">
          Atualizado em{" "}
          {new Date(item.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>

        <FormError message={err} />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
          {confirmDel ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={remove}>Confirmar exclusão</button>
              <button type="button" className="btn" onClick={() => setConfirmDel(false)} disabled={busy}>Cancelar</button>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>Excluir</button>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onClose}>Fechar</button>
            <button type="button" className="btn btn-primary flex-1" onClick={() => onEdit(item)}>Editar</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
