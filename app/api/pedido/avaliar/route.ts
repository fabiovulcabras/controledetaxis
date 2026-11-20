import { precisaCodigo, respostaCodigo } from "@/lib/acesso-solicitante";
import { dentroDoLimite, muitasTentativas, repoServidor, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/** A pessoa autorizada dá a nota (1 a 5) e, se quiser, um comentário para uma corrida concluída dela. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`pedido-avaliar:${corpo.token}`, 10, 60))) return muitasTentativas();
  const nota = Number(corpo?.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return erroJson("Escolha uma nota de 1 a 5.");
  try {
    const sol = await solicitantePorToken(corpo.token);
    if (!sol) return erroJson("Este link não vale mais.", 404);
    if (await precisaCodigo(req, sol as any)) return respostaCodigo();
    const repo = repoServidor();
    const c = await repo.corrida(String(corpo.corrida_id ?? ""));
    if (!c || c.solicitante_id !== sol.id) return erroJson("Corrida não encontrada.", 404);
    const comentario = String(corpo?.comentario ?? "").trim().slice(0, 500) || null;
    if (!(await repo.avaliarCorrida(c.id, nota, comentario))) return erroJson("Esta corrida já foi avaliada ou ainda não foi concluída.", 409);
    return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
