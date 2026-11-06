// Autenticação: supabase-js é usado SÓ para login/sessão. Nenhuma regra de negócio ou permissão é decidida aqui;
// quem autoriza é sempre o back-end (ga4-api). O token vive apenas dentro do supabase-js.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mpfvpngfltmgrmjbibce.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_5zsELWq-mVnSR4HuvBkBSQ_UuLIMhLH"; // chave pública; vale só para o fluxo de login

/** Endereço do site: troque aqui quando o domínio oficial for lançado. Usado no link de recuperação de senha. */
export const getSiteUrl = () => window.location.origin;

let client: SupabaseClient | null = null;
export function getAuth() {
  client ??= createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client.auth;
}

export type Me = { id: string; email: string; role: "admin" | "viewer" };
