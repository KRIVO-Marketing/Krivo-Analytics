"use client";
import { useMemo, useState } from "react";

const NETWORKS = [
  { id: "instagram", label: "Instagram", medium: "social" },
  { id: "linkedin", label: "LinkedIn", medium: "social" },
  { id: "whatsapp", label: "WhatsApp", medium: "messaging" },
  { id: "tiktok", label: "TikTok", medium: "social" },
  { id: "youtube", label: "YouTube", medium: "social" },
  { id: "threads", label: "Threads", medium: "social" },
] as const;

const PROFILES = [
  { id: "krivo", label: "KRIVO" },
  { id: "murilo", label: "Murilo" },
  { id: "gustavo", label: "Gustavo" },
  { id: "daniel", label: "Daniel" },
  { id: "mateus", label: "Mateus" },
  { id: "eduardo", label: "Eduardo" },
] as const;

const PLACEMENTS = [
  { id: "bio", label: "Bio", paid: false },
  { id: "post", label: "Post", paid: false },
  { id: "stories", label: "Stories", paid: false },
  { id: "reels", label: "Reels / Vídeo", paid: false },
  { id: "dm", label: "Direct / Mensagem", paid: false },
  { id: "ads", label: "Anúncio", paid: true },
] as const;

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "https://krivo.com.br";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function UtmGenerator() {
  const [baseUrl, setBaseUrl] = useState("https://krivo.com.br");
  const [network, setNetwork] = useState<string>("instagram");
  const [customNetwork, setCustomNetwork] = useState("");
  const [profile, setProfile] = useState<string>("murilo");
  const [customProfile, setCustomProfile] = useState("");
  const [placement, setPlacement] = useState<string>("bio");
  const [contentTag, setContentTag] = useState("");
  const [copied, setCopied] = useState(false);

  const generatedUrl = useMemo(() => {
    const netCfg = NETWORKS.find((n) => n.id === network);
    const placeCfg = PLACEMENTS.find((p) => p.id === placement);
    const source = network === "other" ? slugify(customNetwork) || "outro" : network;
    const medium = placeCfg?.paid ? "paid_social" : netCfg?.medium ?? "social";
    const profileSlug = profile === "other" ? slugify(customProfile) || "equipe" : profile;
    const campaign = `${placement}-${profileSlug}`;
    const content = slugify(contentTag);

    try {
      const url = new URL(normalizeUrl(baseUrl));
      url.searchParams.set("utm_source", source);
      url.searchParams.set("utm_medium", medium);
      url.searchParams.set("utm_campaign", campaign);
      if (content) url.searchParams.set("utm_content", content);
      return url.toString();
    } catch {
      return "";
    }
  }, [baseUrl, network, customNetwork, profile, customProfile, placement, contentTag]);

  async function handleCopy() {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencioso se clipboard API não estiver disponível
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-line bg-bg/60 p-3.5 sm:p-4">
      <div className="mb-3">
        <p className="text-sm font-medium text-ink">Gerador de Link Rastreável (UTM)</p>
        <p className="text-xs text-mute">
          Escolha a rede, o perfil e onde o link vai ser usado para acompanhar cada origem separada no painel.
        </p>
      </div>

      <div className="space-y-3.5">
        <div>
          <label htmlFor="utm-base-url" className="mb-1 block text-xs font-medium text-mute">
            Link de destino (site ou página)
          </label>
          <input
            id="utm-base-url"
            type="url"
            inputMode="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://krivo.com.br"
            className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-mute">1. Qual rede social?</p>
          <div className="flex flex-wrap gap-1.5">
            {NETWORKS.map((n) => (
              <button
                key={n.id}
                type="button"
                aria-pressed={network === n.id}
                onClick={() => setNetwork(n.id)}
                className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition ${
                  network === n.id
                    ? "border-[var(--btn)] bg-[var(--btn)] text-[var(--btn-ink)]"
                    : "border-line bg-card text-ink hover:bg-accent-soft"
                }`}
              >
                {n.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={network === "other"}
              onClick={() => setNetwork("other")}
              className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition ${
                network === "other"
                  ? "border-[var(--btn)] bg-[var(--btn)] text-[var(--btn-ink)]"
                  : "border-line bg-card text-ink hover:bg-accent-soft"
              }`}
            >
              Outra
            </button>
          </div>
          {network === "other" && (
            <input
              type="text"
              value={customNetwork}
              onChange={(e) => setCustomNetwork(e.target.value)}
              placeholder="Nome da rede (ex.: newsletter, youtube-shorts)"
              className="mt-2 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-mute">2. Perfil de quem?</p>
          <div className="flex flex-wrap gap-1.5">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={profile === p.id}
                onClick={() => setProfile(p.id)}
                className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition ${
                  profile === p.id
                    ? "border-[var(--btn)] bg-[var(--btn)] text-[var(--btn-ink)]"
                    : "border-line bg-card text-ink hover:bg-accent-soft"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={profile === "other"}
              onClick={() => setProfile("other")}
              className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition ${
                profile === "other"
                  ? "border-[var(--btn)] bg-[var(--btn)] text-[var(--btn-ink)]"
                  : "border-line bg-card text-ink hover:bg-accent-soft"
              }`}
            >
              Outro
            </button>
          </div>
          {profile === "other" && (
            <input
              type="text"
              value={customProfile}
              onChange={(e) => setCustomProfile(e.target.value)}
              placeholder="Nome do perfil"
              className="mt-2 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-mute">3. Onde vai usar?</p>
          <div className="flex flex-wrap gap-1.5">
            {PLACEMENTS.map((pl) => (
              <button
                key={pl.id}
                type="button"
                aria-pressed={placement === pl.id}
                onClick={() => setPlacement(pl.id)}
                className={`min-h-9 rounded-lg border px-3 text-xs font-medium transition ${
                  placement === pl.id
                    ? "border-[var(--btn)] bg-[var(--btn)] text-[var(--btn-ink)]"
                    : "border-line bg-card text-ink hover:bg-accent-soft"
                }`}
              >
                {pl.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="utm-content-tag" className="mb-1 block text-xs font-medium text-mute">
            Identificador do post/assunto <span className="font-normal">(opcional — ex.: carrossel-ia, case-clinica)</span>
          </label>
          <input
            id="utm-content-tag"
            type="text"
            value={contentTag}
            onChange={(e) => setContentTag(e.target.value)}
            placeholder="Opcional: tema ou data do conteúdo"
            className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <div className="rounded-xl border border-line bg-card p-3">
          <p className="mb-1 text-xs font-medium text-mute">Link pronto para copiar</p>
          <p className="break-all font-mono text-xs text-ink">{generatedUrl || "Informe uma URL válida acima."}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!generatedUrl}
              className="btn min-h-10 w-full sm:w-auto"
            >
              {copied ? "Copiado!" : "Copiar link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
