// Única parte do front-end que conhece o back-end. Nenhuma regra de negócio aqui:
// toda validação e permissão acontece na função ga4-api.
import { getAuth } from "./auth";

export const BASE_URL = "https://mpfvpngfltmgrmjbibce.supabase.co/functions/v1/ga4-api";

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

// O AuthGate registra o que fazer quando a sessão cai (401) ou o usuário não tem acesso (403 sem_permissao).
type Handlers = { onExpired: () => void; onForbidden: () => void };
let handlers: Handlers | null = null;
export function registerAuthHandlers(h: Handlers | null) {
  handlers = h;
}

async function call<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data } = await getAuth().getSession();
  const token = data.session?.access_token;
  if (!token) {
    handlers?.onExpired();
    throw new ApiError("Sua sessão expirou. Entre novamente.", "nao_autenticado", 401);
  }

  let res: Response;
  try {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
      credentials: "omit",
    });
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
    const code: string = json?.error?.code ?? "interno";
    if (res.status === 401) handlers?.onExpired();
    else if (res.status === 403 && code === "sem_permissao") handlers?.onForbidden();
    throw new ApiError(json?.error?.message ?? "Algo deu errado. Tente de novo.", code, res.status);
  }
  return json as T;
}

export const apiRead = <T,>(body: Record<string, unknown>, signal?: AbortSignal) => call<T>(body, signal);
export const apiWrite = <T,>(body: Record<string, unknown>) => call<T>(body);
