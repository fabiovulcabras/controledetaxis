import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertar, avisarSolicitante, cancelarCorrida } from "@/lib/bot/acoes";
import { enviarSaidas, modoEnvio } from "@/lib/whatsapp/transporte";
import {
  linkWhatsApp, msgAceitaSolicitante, msgNaoRealizadaSolicitante, msgRecusaPlanejamento, msgRecusaSolicitante, urlApp, type LinkWhatsApp,
} from "@/lib/whatsapp/link";
import { corridaPorTokenFornecedor, primeiroTelefonePlanejamento, repoServidor, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { STATUS } from "@/lib/status";
import { brl, formatarDataHora, lerValor } from "@/lib/datas";
import type { Saida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";
const LINK_ANTIGO = "Este link não vale mais. A corrida pode ter passado para outro fornecedor.";

/** Corrida vista pelo fornecedor (pelo link recebido no WhatsApp). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  try {
    const c = await corridaPorTokenFornecedor(token);
    if (!c) return erroJson(LINK_ANTIGO, 404);
    const repo = repoServidor();
    const [sol, forn] = await Promise.all([repo.solicitante(c.solicitante_id), c.fornecedor_id ? repo.fornecedor(c.fornecedor_id) : null]);
    return Response.json({
      protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status].rotulo, fornecedor: forn?.nome ?? null,
      quando: c.tipo === "imediata" ? `Agora (pedido às ${formatarDataHora(c.criado_em).slice(6)})` : formatarDataHora(c.data_hora_prevista),
      tipo: c.tipo, origem: c.origem, destino: c.destino, passageiros: c.qtd_passageiros, outros_passageiros: c.outros_passageiros ?? null,
      solicitante: sol?.nome ?? "—", prazo: c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? formatarDataHora(c.prazo_resposta_em) : null,
      motorista: c.motorista ?? null, placa: c.veiculo_placa ?? null, minutos: c.eta_minutos ?? null,
      valor: c.valor_informado ?? null, motivo_cancelamento: c.motivo_cancelamento ?? null,
      mapa_origem: c.origem_lat != null && c.origem_lng != null ? `https://www.google.com/maps?q=${c.origem_lat},${c.origem_lng}` : `https://www.google.com/maps/search/${encodeURIComponent(c.origem)}`,
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Respostas do fornecedor: aceitar (com motorista), recusar, embarque, concluir com valor, não realizada. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  try {
    const c = await corridaPorTokenFornecedor(corpo.token);
    if (!c) return erroJson(LINK_ANTIGO, 404);
    const repo = repoServidor();
    const base = urlApp(req);
    const [sol, forn] = await Promise.all([repo.solicitante(c.solicitante_id), c.fornecedor_id ? repo.fornecedor(c.fornecedor_id) : null]);
    const nomeForn = forn?.nome ?? "o fornecedor";
    const links: LinkWhatsApp[] = [];
    const saidas: Saida[] = [];
    const acao = String(corpo.acao ?? "");
    const situacao = () => erroJson(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}". Atualize a página.`, 409);

    if (acao === "aceitar") {
      if (!["enviada", "sem_resposta"].includes(c.status)) return situacao();
      const motorista = String(corpo.motorista ?? "").trim();
      if (motorista.length < 2) return erroJson("Informe o nome do motorista.");
      const placa = String(corpo.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7) || null;
      const minutos = Number(corpo.minutos);
      const atrasado = c.status === "sem_resposta";
      const atual = await repo.mudarStatus(c.id, "aceita", "fornecedor", atrasado ? "Aceita depois do prazo (pelo link)" : "Aceita pelo link", {
        motorista, veiculo_placa: placa, eta_minutos: Number.isInteger(minutos) && minutos > 0 && minutos < 600 ? minutos : null,
      });
      if (sol) {
        links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, msgAceitaSolicitante(atual, nomeForn, base, sol.token_pedido)) });
        saidas.push(...await avisarSolicitante(repo, atual, msgAceitaSolicitante(atual, nomeForn, base), `aceita por ${nomeForn}`));
      }
      if (atrasado) saidas.push(...await alertar(repo, atual, "aceita pelo fornecedor depois do prazo"));
    } else if (acao === "recusar") {
      if (!["enviada", "sem_resposta"].includes(c.status)) return situacao();
      const motivo = String(corpo.motivo ?? "").trim() || "Recusada pelo fornecedor";
      const atual = await repo.mudarStatus(c.id, "recusada", "fornecedor", `${motivo} (pelo link)`, { motivo_recusa: motivo });
      const plan = await primeiroTelefonePlanejamento(repo);
      if (plan) links.push({ rotulo: "Avisar o planejamento pelo WhatsApp", url: linkWhatsApp(plan, msgRecusaPlanejamento(atual, nomeForn, sol?.nome ?? "-", base)) });
      if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, msgRecusaSolicitante(atual, nomeForn)) });
      saidas.push(...await alertar(repo, atual, "recusada pelo fornecedor"));
    } else if (acao === "embarque") {
      if (c.status !== "aceita") return situacao();
      await repo.mudarStatus(c.id, "em_andamento", "fornecedor", "Passageiro embarcou (pelo link)");
    } else if (acao === "concluir") {
      if (!["aceita", "em_andamento"].includes(c.status)) return situacao();
      const valor = typeof corpo.valor === "number" ? corpo.valor : lerValor(String(corpo.valor ?? ""));
      if (valor == null || valor <= 0) return erroJson("Informe o valor da corrida, por exemplo 68,50.");
      const atual = await repo.mudarStatus(c.id, "concluida", "fornecedor", `Concluída, valor informado ${brl(valor)} (pelo link)`, { valor_informado: valor });
      const cc = c.centro_custo_id ? await repo.centroCusto(c.centro_custo_id) : null;
      if (cc?.teto_por_corrida && valor > Number(cc.teto_por_corrida)) saidas.push(...await alertar(repo, atual, `valor ${brl(valor)} acima do teto de ${brl(Number(cc.teto_por_corrida))}`));
    } else if (acao === "nao_realizada") {
      if (!["aceita", "em_andamento"].includes(c.status)) return situacao();
      const r = await cancelarCorrida(repo, c, "Fornecedor informou que a corrida não foi realizada", "fornecedor");
      if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, msgNaoRealizadaSolicitante(r.corrida)) });
      saidas.push(...r.saidas, ...await alertar(repo, r.corrida, "fornecedor informou que a corrida não foi realizada"));
    } else {
      return erroJson("Ação desconhecida.");
    }

    // Com a API oficial ligada, os avisos saem sozinhos; sem ela, ficam os botões de WhatsApp
    if (modoEnvio() === "whatsapp" && saidas.length) await enviarSaidas(supabaseAdmin(), saidas, "whatsapp");
    return Response.json({ ok: true, links });
  } catch (err) {
    return erroJson(mensagemDeErro(err).replace(/^Atualizar corrida: /, ""), 500);
  }
}
