// Limite de requisições por IP nas páginas do site (freio básico contra abuso).
// Contador em memória: vale por instância do servidor. O limite que protege a API de verdade
// fica no ga4-api (contador compartilhado no Postgres).
import { NextResponse, type NextRequest } from "next/server";

const LIMIT = 60; // requisições por janela, por IP
const WINDOW_MS = 60_000;
const MAX_TRACKED = 5_000; // evita crescer sem limite
const hits = new Map<string, { count: number; start: number }>();

export function middleware(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "desconhecido").trim().slice(0, 64);
  const now = Date.now();

  if (hits.size > MAX_TRACKED) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);

  const cur = hits.get(ip);
  if (!cur || now - cur.start > WINDOW_MS) {
    hits.set(ip, { count: 1, start: now });
    return NextResponse.next();
  }
  cur.count++;
  if (cur.count > LIMIT) {
    const wait = Math.max(1, Math.ceil((cur.start + WINDOW_MS - now) / 1000));
    return new NextResponse("Muitas requisições. Aguarde um instante e tente de novo.", {
      status: 429,
      headers: { "Retry-After": String(wait), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

// Só páginas; arquivos estáticos do Next ficam de fora.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"] };
