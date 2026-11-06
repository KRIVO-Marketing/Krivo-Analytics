// Única parte do front-end que conhece o back-end. Nenhuma regra de negócio aqui.
export const BASE_URL = "https://mpfvpngfltmgrmjbibce.supabase.co/functions/v1/ga4-api";
const PUBLIC_KEY = "sb_publishable_5zsELWq-mVnSR4HuvBkBSQ_UuLIMhLH"; // chave pública (publishable)

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

// Token de administrador: apenas em memória, nunca em localStorage nem no código.
let adminToken: string | null = null;
type TokenPrompt = (message: string) => Promise<string | null>;
let tokenPrompt: TokenPrompt | null = null;
export function registerTokenPrompt(fn: TokenPrompt | null) {
  tokenPrompt = fn;
}

async function call<T>(body: Record<string, unknown>, opts: { signal?: AbortSignal; token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: PUBLIC_KEY,
    Authorization: `Bearer ${PUBLIC_KEY}`,
  };
  if (opts.token) headers["x-admin-token"] = opts.token;

  let res: Response;
  try {
    res = await fetch(BASE_URL, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Não foi possível falar com o servidor. Verifique a conexão e tente de novo.", "rede", 0);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* corpo não é JSON */
  }
  if (!res.ok) {
    throw new ApiError(json?.error?.message ?? "Algo deu errado. Tente de novo.", json?.error?.code ?? "interno", res.status);
  }
  return json as T;
}

export const apiRead = <T,>(body: Record<string, unknown>, signal?: AbortSignal) => call<T>(body, { signal });

/** Escritas: se o back-end pedir o token (401 nao_autorizado), pergunta ao usuário e repete. */
export async function apiWrite<T>(body: Record<string, unknown>): Promise<T> {
  for (;;) {
    try {
      return await call<T>(body, { token: adminToken });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || e.code !== "nao_autorizado" || !tokenPrompt) throw e;
      adminToken = null;
      const t = await tokenPrompt(e.message);
      if (!t) throw e;
      adminToken = t;
    }
  }
}
