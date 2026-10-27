import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { avisarSolicitante, cancelarCorrida, despachar } from "@/lib/bot/acoes";
import { despacharSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { clienteDoUsuario, erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { brl } from "@/lib/datas";
import { linkWhatsApp, msgCancelamentoFornecedor, msgNovaCorridaFornecedor, urlApp, type LinkWhatsApp } from "@/lib/whatsapp/link";
import type { Saida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";

type Acao = "validar" | "contestar" | "reabrir" | "cancelar" | "reenviar" | "ajustar_valor" | "recalcular_preco";

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
    const links: LinkWhatsApp[] = [];
    const sol = await repo.solicitante(c.solicitante_id);
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
        const forn = c.fornecedor_id && ["enviada", "aceita", "em_andamento", "sem_resposta"].includes(c.status) ? await repo.fornecedor(c.fornecedor_id) : null;
        if (forn) links.push({ rotulo: `Avisar ${forn.nome} pelo WhatsApp`, url: linkWhatsApp(forn.telefone_whatsapp, msgCancelamentoFornecedor(c, obs)) });
        if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, `Sua corrida ${c.protocolo} foi cancelada pelo planejamento. Motivo: ${obs}.`) });
        break;
      }
      case "reenviar": {
        const forn = corpo?.fornecedorId ? await repo.fornecedor(String(corpo.fornecedorId)) : null;
        if (!forn?.ativo) return erroJson("Escolha um fornecedor ativo.");
        const r = await despachar(repo, c, forn, new Date(), "planejamento", obs || `Reenviada a ${forn.nome} pelo planejamento`);
        links.push({ rotulo: `Enviar a ${forn.nome} pelo WhatsApp`, url: linkWhatsApp(forn.telefone_whatsapp, msgNovaCorridaFornecedor(r.corrida, sol?.nome ?? "-", urlApp(req))) });
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
      case "recalcular_preco": {
        // Recalcula o valor da tabela (ex.: depois de importar a tabela de preços). Grava com a chave do servidor.
        if (!c.fornecedor_id) return erroJson("A corrida ainda não tem fornecedor.");
        const admin = new RepoSupabase(supabaseAdmin());
        const atual = await admin.corrida(c.id);
        if (!atual) return erroJson("Corrida não encontrada.", 404);
        const p = await admin.precoTabela({ ...atual, preco_calculado_em: null });
        return Response.json({ ok: true, mensagens: 0, links: [], valor_tabela: p?.valor ?? null, descricao: p?.descricao ?? null });
      }
      default:
        return erroJson("Ação desconhecida.");
    }
    // Sem a API oficial, nada sai sozinho: o painel mostra os botões de WhatsApp para enviar à mão
    const oficial = envioAutomatico();
    await despacharSaidas(supabaseAdmin(), saidas);
    return Response.json({ ok: true, mensagens: oficial ? saidas.length : 0, links: oficial ? [] : links });
  } catch (err) {
    return erroJson(mensagemDeErro(err).replace(/^Atualizar corrida: /, ""));
  }
}
