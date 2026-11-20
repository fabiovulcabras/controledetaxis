import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Aparelho liberado para o link de pedido do solicitante, quando o parâmetro pedido_exige_codigo = sim.
 * Cookie "sol_acesso" com até 3 entradas "token-assinatura"; a assinatura sai do link e do código, então gerar
 * novo link (ou novo código) desliga os aparelhos. Sem o parâmetro ligado, todo aparelho com o link pode pedir.
 */
const NOME = "sol_acesso";
const ENTRADA = /^([0-9a-f]{64})-([0-9a-f]{24})$/;
type Cred = { token_pedido?: string | null; codigo_acesso?: string | null };

const assinatura = (c: Cred) => createHash("sha256").update(`taxis-pedido:${c.token_pedido}:${c.codigo_acesso}`).digest("hex").slice(0, 24);

function entradas(req: Request) {
  const bruto = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${NOME}=`))?.slice(NOME.length + 1) ?? "";
  return decodeURIComponent(bruto).split(".").map((e) => ENTRADA.exec(e)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ token: m[1], sig: m[2] })).slice(0, 3);
}

/** O link exige o código neste aparelho? (parâmetro ligado e aparelho ainda não liberado) */
export async function precisaCodigo(req: Request, sol: Cred): Promise<boolean> {
  if (!sol.codigo_acesso || !sol.token_pedido) return false;
  const { data } = await supabaseAdmin().from("parametros").select("valor").eq("chave", "pedido_exige_codigo").maybeSingle();
  if (!/^(sim|s|true|1)$/i.test(String(data?.valor ?? "").trim())) return false;
  const esperada = assinatura(sol);
  return !entradas(req).some((e) => e.token === sol.token_pedido && e.sig === esperada);
}

/** Set-Cookie que libera este aparelho para o link (1 ano). */
export function cookieDoSolicitante(req: Request, sol: Cred): string {
  const nova = `${sol.token_pedido}-${assinatura(sol)}`;
  const valor = [nova, ...entradas(req).filter((e) => e.token !== sol.token_pedido).map((e) => `${e.token}-${e.sig}`)].slice(0, 3).join(".");
  const seguro = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${NOME}=${valor}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${seguro}`;
}

export const respostaCodigo = () => Response.json({ erro: "Digite o código de 4 números que veio com o seu link.", codigo: true }, { status: 401 });
