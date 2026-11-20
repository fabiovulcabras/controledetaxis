import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { alterarCorrida, avisarSolicitante, cancelarCorrida, despachar, escolherFornecedor, podeAlterar } from "@/lib/bot/acoes";
import { destinosJuntados } from "@/lib/juntar";
import { otimizarDestinos } from "@/lib/km-corrida";
import { MAX_DESTINOS, trajetoTexto } from "@/lib/multidestino";
import { formatarDataHora } from "@/lib/datas";
import { despacharSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { clienteDoUsuario, erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { brl } from "@/lib/datas";
import { linkWhatsApp, msgCancelamentoFornecedor, msgNovaCorridaFornecedor, urlApp, type LinkWhatsApp } from "@/lib/whatsapp/link";
import type { Saida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";

type Acao = "validar" | "contestar" | "reabrir" | "cancelar" | "reenviar" | "ajustar_valor" | "recalcular_preco" | "aprovar" | "recusar_aprovacao" | "juntar";

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
      case "aprovar": {
        // Aprovação do planejamento: a corrida segue para o fornecedor da vez (o mais barato para o trecho, ou o padrão da pessoa)
        if (c.status !== "solicitada" || c.aprovacao_status !== "pendente") return erroJson("Esta corrida não está aguardando aprovação.", 409);
        const admin = new RepoSupabase(supabaseAdmin());
        const atual = await repo.mudarStatus(c.id, null, "planejamento", `Aprovada por ${usuario.nome}${obs ? `: ${obs}` : ""}`, { aprovacao_status: "aprovada" });
        await supabaseAdmin().from("corridas").update({ aprovacao_por: usuario.id, aprovacao_em: new Date().toISOString() }).eq("id", c.id);
        const forn = await escolherFornecedor(admin, sol?.fornecedor_padrao_id, atual);
        if (!forn) return erroJson("Aprovada, mas não há fornecedor ativo para enviar. Use Reenviar.");
        const r = await despachar(repo, atual, forn, new Date(), "planejamento", `Enviada a ${forn.nome} após aprovação`);
        links.push({ rotulo: `Enviar a ${forn.nome} pelo WhatsApp`, url: linkWhatsApp(forn.telefone_whatsapp, msgNovaCorridaFornecedor(r.corrida, sol?.nome ?? "-", urlApp(req))) });
        saidas = [...r.saidas, ...await avisarSolicitante(repo, r.corrida,
          `Sua corrida ${c.protocolo} foi aprovada pelo planejamento e enviada ao fornecedor ${forn.nome}. Avisaremos quando ele responder.`, `aprovada e enviada a ${forn.nome}`)];
        break;
      }
      case "recusar_aprovacao": {
        if (c.status !== "solicitada" || c.aprovacao_status !== "pendente") return erroJson("Esta corrida não está aguardando aprovação.", 409);
        if (!obs) return erroJson("Informe o motivo da recusa.");
        await repo.mudarStatus(c.id, null, "planejamento", `Não aprovada por ${usuario.nome}: ${obs}`, { aprovacao_status: "recusada" });
        await supabaseAdmin().from("corridas").update({ aprovacao_por: usuario.id, aprovacao_em: new Date().toISOString() }).eq("id", c.id);
        const r = await cancelarCorrida(repo, { ...c, aprovacao_status: "recusada" }, `Não aprovada: ${obs}`, "planejamento");
        saidas = [...r.saidas, ...await avisarSolicitante(repo, r.corrida, `Sua corrida ${c.protocolo} não foi aprovada pelo planejamento. Motivo: ${obs}.`, `não aprovada: ${obs}`)];
        if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, `Sua corrida ${c.protocolo} não foi aprovada pelo planejamento. Motivo: ${obs}.`) });
        break;
      }
      case "juntar": {
        // A outra corrida (mesma origem, horário próximo) entra nesta: passageiros somados, destino dela vira parada
        // (ordem de menor km; o mais longe é o final) e ela é cancelada, apontando para esta.
        const outra = corpo?.outraId ? await repo.corrida(String(corpo.outraId)) : null;
        if (!outra || outra.id === c.id) return erroJson("Escolha a outra corrida.");
        if (!podeAlterar(c) || !podeAlterar(outra)) return erroJson("Só dá para juntar corridas que o fornecedor ainda não aceitou.", 409);
        const destinos = destinosJuntados(c, outra);
        if (destinos.length > MAX_DESTINOS) return erroJson(`Juntas, as corridas passariam de ${MAX_DESTINOS} destinos.`);
        const db = supabaseAdmin();
        const admin = new RepoSupabase(db);
        const ot = destinos.length > 1 ? await otimizarDestinos(db, { texto: c.origem, lat: c.origem_lat ?? null, lng: c.origem_lng ?? null }, destinos).catch(() => null) : null;
        const ordem = ot?.ordem ?? [...destinos.keys()];
        const final = destinos[ordem[ordem.length - 1]];
        const paradas = ordem.slice(0, -1).map((i) => destinos[i]).map((p) => ({ texto: p.texto, lat: p.lat, lng: p.lng }));
        const solOutra = await repo.solicitante(outra.solicitante_id);
        const qtd = (c.qtd_passageiros || 1) + (outra.qtd_passageiros || 1);
        const outros = [c.outros_passageiros, `${solOutra?.nome ?? "outro solicitante"}${outra.qtd_passageiros > 1 ? ` (+${outra.qtd_passageiros - 1})` : ""}`, outra.outros_passageiros].filter(Boolean).join("; ").slice(0, 200);
        const cedo = new Date(Math.min(new Date(c.data_hora_prevista).getTime(), new Date(outra.data_hora_prevista).getTime())).toISOString();
        const r = await alterarCorrida(admin, c, {
          destino: final.texto, destino_lat: final.lat, destino_lng: final.lng, paradas, qtd_passageiros: qtd, outros_passageiros: outros, data_hora_prevista: cedo,
        }, `juntada com ${outra.protocolo} por ${usuario.nome}: ${qtd} passageiros`, "planejamento");
        if (ot) await db.from("corridas").update({ distancia_km: ot.km, distancia_fonte: ot.fonte, distancia_calculada_em: new Date().toISOString() }).eq("id", c.id);
        const can = await cancelarCorrida(admin, outra, `Juntada à corrida ${c.protocolo}`, "planejamento");
        await admin.mudarStatus(outra.id, null, "planejamento", `Juntada à corrida ${c.protocolo}`, { juntada_em: c.id });
        const quando = formatarDataHora(r.corrida.data_hora_prevista);
        saidas = [...r.saidas, ...can.saidas,
          ...await avisarSolicitante(admin, r.corrida, `Sua corrida ${c.protocolo} vai levar também ${solOutra?.nome ?? "outro passageiro"} (mesma saída). Horário: ${quando}. Trajeto: ${trajetoTexto(r.corrida)}.`, `juntada com ${outra.protocolo}`),
          ...await avisarSolicitante(admin, can.corrida, `Sua corrida ${outra.protocolo} foi juntada à corrida ${c.protocolo}, de ${sol?.nome ?? "outro passageiro"}, no mesmo carro. Horário: ${quando}. Acompanhe pela corrida ${c.protocolo}.`, `juntada à ${c.protocolo}`)];
        break;
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
