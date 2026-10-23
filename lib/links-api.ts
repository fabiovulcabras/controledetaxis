import { supabaseAdmin } from "./supabase-admin";
import { RepoSupabase } from "./bot/repo-supabase";
import type { Corrida, Solicitante } from "./bot/tipos";

/** Tokens têm 64 caracteres hexadecimais; qualquer outra coisa é recusada sem consultar o banco. */
export const tokenValido = (t: unknown): t is string => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);

export async function solicitantePorToken(token: string): Promise<Solicitante | null> {
  const { data, error } = await supabaseAdmin().from("solicitantes").select("*").eq("token_pedido", token).eq("ativo", true).maybeSingle();
  if (error) throw new Error(error.message.includes("token_pedido") ? "O banco ainda não tem os links de pedido. Rode supabase/002_links_whatsapp.sql no Supabase." : error.message);
  return (data as Solicitante) ?? null;
}

export async function corridaPorTokenFornecedor(token: string): Promise<Corrida | null> {
  const { data, error } = await supabaseAdmin().from("corridas").select("*").eq("token_fornecedor", token).maybeSingle();
  if (error) throw new Error(error.message.includes("token_fornecedor") ? "O banco ainda não tem os links do fornecedor. Rode supabase/002_links_whatsapp.sql no Supabase." : error.message);
  return (data as Corrida) ?? null;
}

export const repoServidor = () => new RepoSupabase(supabaseAdmin());

export async function primeiroTelefonePlanejamento(repo: RepoSupabase): Promise<string | null> {
  return String((await repo.parametro("planejamento_telefones")) ?? "").split(/[,;\s]+/).map((t) => t.replace(/\D/g, "")).find((t) => t.length >= 10) ?? null;
}
