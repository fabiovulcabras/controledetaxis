import { cookieDoSolicitante } from "@/lib/acesso-solicitante";
import { dentroDoLimite, ipDe, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/** Libera este aparelho para o link de pedido com o código de 4 números do solicitante. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  // Poucas tentativas por link e por IP; se o contador falhar, bloqueia (ninguém testa códigos sem limite)
  if (!(await dentroDoLimite(`pedido-codigo:${corpo.token}`, 5, 900, true)) || !(await dentroDoLimite(`pedido-codigo-ip:${ipDe(req)}`, 15, 900, true))) {
    return erroJson("Muitas tentativas. Aguarde 15 minutos ou peça o código ao planejamento.", 429);
  }
  try {
    const sol = await solicitantePorToken(corpo.token) as any;
    if (!sol) return erroJson("Este link não vale mais. Peça um novo link ao setor de planejamento.", 404);
    const codigo = String(corpo?.codigo ?? "").replace(/\D/g, "");
    if (!sol.codigo_acesso || codigo !== sol.codigo_acesso) return erroJson("Código incorreto. Confira a mensagem com o seu link ou peça ao planejamento.", 403);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieDoSolicitante(req, sol) } });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
