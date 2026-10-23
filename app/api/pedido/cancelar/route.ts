import { supabaseAdmin } from "@/lib/supabase-admin";
import { cancelarCorrida } from "@/lib/bot/acoes";
import { enviarSaidas, modoEnvio } from "@/lib/whatsapp/transporte";
import { linkWhatsApp, msgCancelamentoFornecedor } from "@/lib/whatsapp/link";
import { repoServidor, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { CANCELAVEIS } from "@/lib/status";

export const dynamic = "force-dynamic";

/** A pessoa autorizada cancela uma corrida dela pelo link de pedido. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  const motivo = String(corpo?.motivo ?? "").trim();
  if (motivo.length < 3) return erroJson("Informe o motivo do cancelamento.");
  try {
    const sol = await solicitantePorToken(corpo.token);
    if (!sol) return erroJson("Este link não vale mais.", 404);
    const repo = repoServidor();
    const c = await repo.corrida(String(corpo.corrida_id ?? ""));
    if (!c || c.solicitante_id !== sol.id) return erroJson("Corrida não encontrada.", 404);
    if (!CANCELAVEIS.includes(c.status)) return erroJson("Esta corrida não pode mais ser cancelada.");
    const antes = c.status;
    const r = await cancelarCorrida(repo, c, motivo, "bot");
    if (modoEnvio() === "whatsapp") await enviarSaidas(supabaseAdmin(), r.saidas, "whatsapp");
    const forn = c.fornecedor_id && ["enviada", "aceita", "em_andamento", "sem_resposta"].includes(antes) ? await repo.fornecedor(c.fornecedor_id) : null;
    return Response.json({
      ok: true,
      whatsapp: forn ? linkWhatsApp(forn.telefone_whatsapp, msgCancelamentoFornecedor(c, motivo)) : null,
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
