import { supabaseAdmin } from "@/lib/supabase-admin";
import { aparelhoDoFornecedor } from "@/lib/acesso-fornecedor";
import { corridaPorTokenFornecedor, dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { roteiroDaCorrida } from "@/lib/roteiro";

export const dynamic = "force-dynamic";

/** Roteiro do menor trajeto (km e link do Google Maps) para o fornecedor da corrida, depois do aceite. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`roteiro:${token}`, 20, 600))) return muitasTentativas();
  try {
    const c = await corridaPorTokenFornecedor(token);
    if (!c) return erroJson("Este link não vale mais.", 404);
    if (!(await aparelhoDoFornecedor(req, c.fornecedor_id))) return erroJson("Só o fornecedor vê o roteiro. Entre no seu portal ou digite o código de acesso.", 403);
    if (!["aceita", "em_andamento"].includes(c.status)) return erroJson("O roteiro fica disponível depois de confirmar o atendimento.");
    const r = await roteiroDaCorrida(supabaseAdmin(), c as any);
    return r ? Response.json({ km: r.km, link: r.link, passagens: r.passagens }) : erroJson("Não foi possível localizar a origem ou o destino no mapa.", 502);
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
