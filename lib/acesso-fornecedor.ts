import { createHash } from "node:crypto";

/**
 * Identifica o aparelho do fornecedor. O link de cada corrida (/f/…) passa pela mão do solicitante,
 * então ele sozinho só mostra a corrida; para agir, o aparelho precisa deste cookie, gravado quando o
 * fornecedor entra no portal (e-mail + código de acesso) ou digita o código na página da corrida.
 * Cada entrada é "token_do_portal-assinatura", com a assinatura derivada do código de acesso: gerar novo
 * código ou novo link do portal desconecta os aparelhos. Guarda até 5 fornecedores por aparelho.
 */
const NOME = "forn_acesso";
const ENTRADA = /^([0-9a-f]{64})-([0-9a-f]{24})$/;

type Entrada = { token: string; assinatura: string };
export type CredencialFornecedor = { token_portal: string; codigo_acesso: string };

/** Assinatura que liga o aparelho ao link e ao código de acesso atuais do fornecedor. */
export const assinaturaAcesso = (f: CredencialFornecedor) =>
  createHash("sha256").update(`taxis-portal:${f.token_portal}:${f.codigo_acesso}`).digest("hex").slice(0, 24);

export function entradasDoAparelho(req: Request): Entrada[] {
  const bruto = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${NOME}=`))?.slice(NOME.length + 1) ?? "";
  return decodeURIComponent(bruto).split(".").map((e) => ENTRADA.exec(e)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ token: m[1], assinatura: m[2] })).slice(0, 5);
}

function montarCookie(req: Request, entradas: Entrada[]): string {
  const seguro = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const valor = entradas.map((e) => `${e.token}-${e.assinatura}`).join(".");
  return `${NOME}=${valor}; Path=/; Max-Age=${valor ? 31536000 : 0}; HttpOnly; SameSite=Lax${seguro}`;
}

/** Cabeçalho Set-Cookie que conecta este fornecedor ao aparelho (vale 1 ano). */
export function cookieDoFornecedor(req: Request, f: CredencialFornecedor): string {
  const nova = { token: f.token_portal, assinatura: assinaturaAcesso(f) };
  return montarCookie(req, [nova, ...entradasDoAparelho(req).filter((e) => e.token !== f.token_portal)].slice(0, 5));
}

/** Cabeçalho Set-Cookie que desconecta este fornecedor do aparelho (botão Sair do portal). */
export function cookieSemFornecedor(req: Request, tokenPortal: string): string {
  return montarCookie(req, entradasDoAparelho(req).filter((e) => e.token !== tokenPortal));
}

/** O aparelho entrou no portal deste fornecedor com o link e o código de acesso atuais? */
export function aparelhoConectado(req: Request, f: CredencialFornecedor | null | undefined): boolean {
  if (!f?.token_portal || !f.codigo_acesso) return false;
  const esperada = assinaturaAcesso(f);
  return entradasDoAparelho(req).some((e) => e.token === f.token_portal && e.assinatura === esperada);
}

/** O aparelho está conectado como do fornecedor desta corrida? */
export async function aparelhoDoFornecedor(req: Request, fornecedorId: string | null | undefined): Promise<boolean> {
  const entradas = entradasDoAparelho(req);
  if (!fornecedorId || !entradas.length) return false;
  const { supabaseAdmin } = await import("./supabase-admin");
  const { data } = await supabaseAdmin().from("fornecedores").select("token_portal,codigo_acesso,ativo").eq("id", fornecedorId).maybeSingle();
  return !!data?.ativo && aparelhoConectado(req, data as CredencialFornecedor);
}
