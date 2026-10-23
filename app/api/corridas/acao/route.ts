import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { avisarSolicitante, cancelarCorrida, despachar } from "@/lib/bot/acoes";
import { enviarSaidas, modoEnvio } from "@/lib/whatsapp/transporte";
import { clienteDoUsuario, erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { brl } from "@/lib/datas";
import type { Saida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";

type Acao = "validar" | "contestar" | "reabrir" | "cancelar" | "reenviar" | "ajustar_valor";

/**
 * Ações do planejamento sobre uma corrida. A mudança é feita com a sessão do usuário
 * (fica registrado quem fez); as mensagens de WhatsApp saem pelo servidor.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const acao = corpo?.acao as Acao;
  const obs = typeof corpo?.obs === "string" ? corpo.obs.trim() : "";
  try {
    const repo = new RepoSupabase(await clienteDoUsuario(req));
    const c = corpo?.corridaId ? await repo.corrida(String(corpo.corridaId)) : null;
    if (!c) return erroJson("Corrida não encontrada.", 404);

    let saidas: Saida[] = [];
    switch (acao) {
      case "validar":
        await repo.mudarStatus(c.id, "validada", "planejamento", obs || "Validada pelo planejamento");
        break;
      case "contestar":
      case "reabrir":
        if (!obs) return erroJson("Informe o motivo.");
        await repo.mudarStatus(c.id, "contestada", "planejamento", obs);
        break;
      case "cancelar": {
        if (!obs) return erroJson("Informe o motivo do cancelamento.");
        saidas = (await cancelarCorrida(repo, c, obs, "planejamento", { avisarSolicitante: true })).saidas;
        break;
      }
      case "reenviar": {
        const forn = corpo?.fornecedorId ? await repo.fornecedor(String(corpo.fornecedorId)) : null;
        if (!forn?.ativo) return erroJson("Escolha um fornecedor ativo.");
        const r = await despachar(repo, c, forn, new Date(), "planejamento", obs || `Reenviada a ${forn.nome} pelo planejamento`);
        saidas = [...r.saidas, ...await avisarSolicitante(repo, r.corrida,
          `Sua corrida ${c.protocolo} foi enviada ao fornecedor ${forn.nome}. Avisaremos quando ele responder.`, `enviada ao fornecedor ${forn.nome}`)];
        break;
      }
      case "ajustar_valor": {
        const valor = Number(corpo?.valor);
        if (!Number.isFinite(valor) || valor < 0) return erroJson("Informe um valor válido.");
        if (!obs) return erroJson("Informe o motivo do ajuste.");
        await repo.mudarStatus(c.id, null, "planejamento", `Valor ajustado de ${brl(c.valor_informado)} para ${brl(valor)}: ${obs}`, { valor_informado: valor });
        break;
      }
      default:
        return erroJson("Ação desconhecida.");
    }
    if (saidas.length) await enviarSaidas(supabaseAdmin(), saidas, modoEnvio());
    return Response.json({ ok: true, mensagens: saidas.length });
  } catch (err) {
    return erroJson(mensagemDeErro(err).replace(/^Atualizar corrida: /, ""));
  }
}
