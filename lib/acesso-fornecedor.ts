import { supabaseAdmin } from "./supabase-admin";

/**
 * Identifica o aparelho do fornecedor. O link de cada corrida (/f/…) passa pela mão do solicitante,
 * então ele sozinho só mostra a corrida; para agir, o aparelho precisa deste cookie, gravado quando o
 * fornecedor abre o portal dele ou digita o código de acesso. Guarda até 5 fornecedores por aparelho.
 */
const NOME = "forn_acesso";
const TOKEN = /^[0-9a-f]{64}$/;

export function tokensDoAparelho(req: Request): string[] {
  const bruto = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${NOME}=`))?.slice(NOME.length + 1) ?? "";
  return decodeURIComponent(bruto).split(".").filter((t) => TOKEN.test(t)).slice(0, 5);
}

/** Cabeçalho Set-Cookie que acrescenta o token do portal deste fornecedor ao aparelho (vale 1 ano). */
export function cookieDoFornecedor(req: Request, tokenPortal: string): string {
  const lista = [tokenPortal, ...tokensDoAparelho(req).filter((t) => t !== tokenPortal)].slice(0, 5);
  const seguro = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${NOME}=${lista.join(".")}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${seguro}`;
}

/** O aparelho está identificado como do fornecedor desta corrida? Trocar o link do portal desfaz a identificação. */
export async function aparelhoDoFornecedor(req: Request, fornecedorId: string | null | undefined): Promise<boolean> {
  const tokens = tokensDoAparelho(req);
  if (!fornecedorId || !tokens.length) return false;
  const { data } = await supabaseAdmin().from("fornecedores").select("id").eq("id", fornecedorId).in("token_portal", tokens).maybeSingle();
  return !!data;
}
