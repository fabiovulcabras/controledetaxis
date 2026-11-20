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

/** Conta um uso no limite do banco. Se a migração 003 ainda não rodou, não bloqueia (só registra no log). */
/**
 * Conta uma tentativa e diz se ainda está dentro do limite. Se o contador falhar: libera (`fechado` = false)
 * nas leituras comuns, para uma falha do banco não derrubar o app; bloqueia (`fechado` = true) nos logins e
 * códigos de acesso, para ninguém testar senhas sem limite durante a falha.
 */
export async function dentroDoLimite(chave: string, limite: number, janelaSeg: number, fechado = false): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("fn_consumir_limite", { p_chave: chave, p_limite: limite, p_janela_seg: janelaSeg });
  if (error) { console.error("Limite de uso indisponível", error.message); return !fechado; }
  return data !== false;
}

export const muitasTentativas = () => Response.json({ erro: "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo." }, { status: 429 });

/** IP de quem chamou (atrás do proxy da hospedagem). */
export const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";
