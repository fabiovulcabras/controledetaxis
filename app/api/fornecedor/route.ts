import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertar, avisarSolicitante, cancelarCorrida, reenviarAutomatico, valorEsperado, verificarValor } from "@/lib/bot/acoes";
import { despacharSaidas } from "@/lib/whatsapp/transporte";
import {
  linkWhatsApp, msgAceitaSolicitante, msgNaoRealizadaSolicitante, msgNovaCorridaFornecedor, msgRecusaPlanejamento, msgRecusaSolicitante, urlApp, type LinkWhatsApp,
} from "@/lib/whatsapp/link";
import { corridaPorTokenFornecedor, dentroDoLimite, ipDe, muitasTentativas, primeiroTelefonePlanejamento, repoServidor, tokenValido } from "@/lib/links-api";
import { aparelhoDoFornecedor, cookieDoFornecedor } from "@/lib/acesso-fornecedor";
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
  if (!(await dentroDoLimite(`fornecedor-ler:${token}`, 60, 60))) return muitasTentativas();
  try {
    const c = await corridaPorTokenFornecedor(token);
    if (!c) return erroJson(LINK_ANTIGO, 404);
    const repo = repoServidor();
    const [sol, forn] = await Promise.all([repo.solicitante(c.solicitante_id), c.fornecedor_id ? repo.fornecedor(c.fornecedor_id) : null]);
    return Response.json({
      autorizado: await aparelhoDoFornecedor(req, c.fornecedor_id),
      protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status].rotulo, fornecedor: forn?.nome ?? null,
      quando: c.tipo === "imediata" ? `Agora (pedido às ${formatarDataHora(c.criado_em).slice(6)})` : formatarDataHora(c.data_hora_prevista),
      tipo: c.tipo, origem: c.origem, destino: c.destino, passageiros: c.qtd_passageiros, outros_passageiros: c.outros_passageiros ?? null,
      solicitante: sol?.nome ?? "—", prazo: c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? formatarDataHora(c.prazo_resposta_em) : null,
      motorista: c.motorista ?? null, placa: c.veiculo_placa ?? null, minutos: c.eta_minutos ?? null,
      valor: c.valor_informado ?? null, motivo_cancelamento: c.motivo_cancelamento ?? null,
      distancia_km: c.distancia_km ?? null, valor_esperado: valorEsperado(c, forn),
      prazo_iso: c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? c.prazo_resposta_em : null,
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
  if (!(await dentroDoLimite(`fornecedor-agir:${corpo.token}`, 20, 60))) return muitasTentativas();
  try {
    const c = await corridaPorTokenFornecedor(corpo.token);
    if (!c) return erroJson(LINK_ANTIGO, 404);
    const acao = String(corpo.acao ?? "");

    // Identificação do aparelho pelo código de acesso de 6 dígitos (enviado só pelo planejamento ao fornecedor)
    if (acao === "entrar") {
      if (!(await dentroDoLimite(`fornecedor-codigo:${ipDe(req)}`, 8, 900)) || !(await dentroDoLimite(`fornecedor-codigo:${corpo.token}`, 8, 900))) {
        return erroJson("Muitas tentativas. Aguarde 15 minutos ou peça o código ao planejamento.", 429);
      }
      const codigo = String(corpo.codigo ?? "").replace(/\D/g, "");
      if (!c.fornecedor_id || codigo.length !== 6) return erroJson("Digite os 6 números do código de acesso.");
      const { data: f, error } = await supabaseAdmin().from("fornecedores").select("token_portal,codigo_acesso").eq("id", c.fornecedor_id).maybeSingle();
      if (error) throw new Error(error.message.includes("codigo_acesso") ? "O banco ainda não tem o código de acesso. Rode supabase/004_acesso_fornecedor.sql no Supabase." : error.message);
      if (!f || f.codigo_acesso !== codigo) return erroJson("Código incorreto. Confira com o planejamento.", 403);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieDoFornecedor(req, f.token_portal) } });
    }
    if (!(await aparelhoDoFornecedor(req, c.fornecedor_id))) {
      return erroJson("Só o fornecedor pode responder esta corrida. Abra pelo seu portal ou digite o código de acesso.", 403);
    }

    const repo = repoServidor();
    const base = urlApp(req);
    const [sol, forn] = await Promise.all([repo.solicitante(c.solicitante_id), c.fornecedor_id ? repo.fornecedor(c.fornecedor_id) : null]);
    const nomeForn = forn?.nome ?? "o fornecedor";
    const links: LinkWhatsApp[] = [];
    const saidas: Saida[] = [];
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
      // Reenvio automático: a corrida passa ao próximo fornecedor; o solicitante recebe o link pronto para mandar a ele
      const r = await reenviarAutomatico(repo, atual, new Date());
      if (r) {
        const linkProximo = linkWhatsApp(r.fornecedor.telefone_whatsapp, msgNovaCorridaFornecedor(r.corrida, sol?.nome ?? "-", base));
        if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp,
          `${nomeForn} não poderá atender a corrida ${c.protocolo}. Ela foi passada para ${r.fornecedor.nome}. Toque para enviar a ele:\n${linkProximo}`) });
        saidas.push(...r.saidas, ...await avisarSolicitante(repo, r.corrida, `${nomeForn} não atendeu a corrida ${c.protocolo}. Enviamos a ${r.fornecedor.nome}.`, `recusada; enviada a ${r.fornecedor.nome}`));
      } else {
        const plan = await primeiroTelefonePlanejamento(repo);
        if (plan) links.push({ rotulo: "Avisar o planejamento pelo WhatsApp", url: linkWhatsApp(plan, msgRecusaPlanejamento(atual, nomeForn, sol?.nome ?? "-", base)) });
        if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, msgRecusaSolicitante(atual, nomeForn)) });
        saidas.push(...await alertar(repo, atual, "recusada pelo fornecedor"));
      }
    } else if (acao === "embarque") {
      if (c.status !== "aceita") return situacao();
      await repo.mudarStatus(c.id, "em_andamento", "fornecedor", "Passageiro embarcou (pelo link)");
    } else if (acao === "concluir") {
      if (!["aceita", "em_andamento"].includes(c.status)) return situacao();
      const valor = typeof corpo.valor === "number" ? corpo.valor : lerValor(String(corpo.valor ?? ""));
      if (valor == null || valor <= 0) return erroJson("Informe o valor da corrida, por exemplo 68,50.");
      const atual = await repo.mudarStatus(c.id, "concluida", "fornecedor", `Concluída, valor informado ${brl(valor)} (pelo link)`, { valor_informado: valor });
      saidas.push(...await verificarValor(repo, atual, valor, new Date()));
    } else if (acao === "nao_realizada") {
      if (!["aceita", "em_andamento"].includes(c.status)) return situacao();
      const r = await cancelarCorrida(repo, c, "Fornecedor informou que a corrida não foi realizada", "fornecedor");
      if (sol) links.push({ rotulo: `Avisar ${sol.nome.split(" ")[0]} pelo WhatsApp`, url: linkWhatsApp(sol.telefone_whatsapp, msgNaoRealizadaSolicitante(r.corrida)) });
      saidas.push(...r.saidas, ...await alertar(repo, r.corrida, "fornecedor informou que a corrida não foi realizada"));
    } else {
      return erroJson("Ação desconhecida.");
    }

    // Com a API oficial ligada, os avisos saem sozinhos; sem ela, ficam os botões de WhatsApp (e-mails de alerta saem nos dois casos)
    await despacharSaidas(supabaseAdmin(), saidas);
    return Response.json({ ok: true, links });
  } catch (err) {
    return erroJson(mensagemDeErro(err).replace(/^Atualizar corrida: /, ""), 500);
  }
}
