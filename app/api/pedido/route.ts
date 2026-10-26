import { supabaseAdmin } from "@/lib/supabase-admin";
import { escolherFornecedor, despachar, avisarPlanejamento, numero } from "@/lib/bot/acoes";
import { despacharSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { linkWhatsApp, msgNovaCorridaFornecedor, urlApp } from "@/lib/whatsapp/link";
import { dentroDoLimite, ipDe, muitasTentativas, repoServidor, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { CANCELAVEIS, STATUS } from "@/lib/status";
import { formatarDataHora } from "@/lib/datas";
import { distanciaTrajeto } from "@/lib/distancia";
import { locaisDoPedido } from "@/lib/locais";
import type { Corrida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";
const MOTIVOS = ["Visita a cliente", "Viagem / aeroporto", "Hora extra", "Visita a fornecedor"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Endereços que a pessoa mais usa (origens e destinos das últimas corridas), sem repetir. */
function frequentes(corridas: any[]): { endereco: string; lat: number | null; lng: number | null }[] {
  const contagem = new Map<string, { endereco: string; lat: number | null; lng: number | null; n: number }>();
  for (const c of corridas) {
    for (const [endereco, lat, lng] of [[c.origem, c.origem_lat, c.origem_lng], [c.destino, c.destino_lat, c.destino_lng]] as const) {
      const chave = String(endereco).trim().toLowerCase();
      const atual = contagem.get(chave);
      if (atual) atual.n++;
      else contagem.set(chave, { endereco, lat: num(lat), lng: num(lng), n: 1 });
    }
  }
  return [...contagem.values()].sort((a, b) => b.n - a.n).slice(0, 5).map(({ n, ...resto }) => resto);
}

/** Dados para a página de pedido: quem é, opções do formulário, endereços frequentes e as últimas corridas. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`pedido-ler:${token}`, 60, 60))) return muitasTentativas();
  try {
    const sol = await solicitantePorToken(token);
    if (!sol) return erroJson("Este link não vale mais. Peça um novo link ao setor de planejamento.", 404);
    const repo = repoServidor();
    const db = supabaseAdmin();
    const base = urlApp(req);
    const [locais, centros, maxDias, recentes] = await Promise.all([
      locaisDoPedido(db, sol.unidade_id),
      repo.centrosCusto(sol.unidade_id),
      numero(repo, "antecedencia_maxima_dias", 30),
      db.from("corridas").select("*, fornecedores(nome,telefone_whatsapp)").eq("solicitante_id", sol.id).order("criado_em", { ascending: false }).limit(20),
    ]);
    const lista = recentes.data ?? [];
    return Response.json({
      nome: sol.nome,
      locais,
      centros: centros.map((c) => ({ id: c.id, rotulo: `${c.codigo} · ${c.descricao}` })),
      centro_padrao: sol.centro_custo_padrao_id ?? null,
      motivos: MOTIVOS,
      max_dias: maxDias,
      frequentes: frequentes(lista),
      corridas: lista.slice(0, 10).map((c: any) => ({
        id: c.id, protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status as keyof typeof STATUS]?.rotulo ?? c.status,
        quando: formatarDataHora(c.data_hora_prevista), origem: c.origem, destino: c.destino, fornecedor: c.fornecedores?.nome ?? null,
        motorista: [c.motorista, c.veiculo_placa, c.eta_minutos ? `${c.eta_minutos} min` : null].filter(Boolean).join(" · ") || null,
        pode_cancelar: CANCELAVEIS.includes(c.status),
        // Para o botão "Repetir": refaz o formulário com os mesmos dados
        repetir: {
          origem: c.origem, origem_lat: num(c.origem_lat), origem_lng: num(c.origem_lng), destino: c.destino, destino_lat: num(c.destino_lat), destino_lng: num(c.destino_lng),
          qtd_passageiros: c.qtd_passageiros, outros_passageiros: c.outros_passageiros ?? "", centro_custo_id: c.centro_custo_id, motivo: c.motivo,
        },
        // Enquanto o fornecedor não respondeu, a pessoa pode reenviar a mensagem pelo WhatsApp
        whatsapp_fornecedor: ["enviada", "sem_resposta"].includes(c.status) && c.fornecedores?.telefone_whatsapp
          ? linkWhatsApp(c.fornecedores.telefone_whatsapp, msgNovaCorridaFornecedor(c, sol.nome, base)) : null,
      })),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Resposta padrão de um pedido gravado (também usada quando o mesmo envio chega duas vezes). */
async function respostaPedido(req: Request, c: Corrida, solicitante: string, aviso?: string) {
  const repo = repoServidor();
  const forn = c.fornecedor_id ? await repo.fornecedor(c.fornecedor_id) : null;
  if (!forn) return Response.json({ protocolo: c.protocolo, fornecedor: null, aviso: aviso ?? "Não há fornecedor ativo cadastrado. O planejamento vai providenciar." });
  return Response.json({
    protocolo: c.protocolo, fornecedor: forn.nome, envio_automatico: envioAutomatico(), aviso,
    whatsapp: linkWhatsApp(forn.telefone_whatsapp, msgNovaCorridaFornecedor(c, solicitante, urlApp(req))),
  });
}

/** Grava o pedido, envia ao fornecedor e devolve o link de WhatsApp com a mensagem pronta. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`pedido-enviar:${corpo.token}`, 10, 60))) return muitasTentativas();
  try {
    const sol = await solicitantePorToken(corpo.token);
    if (!sol) return erroJson("Este link não vale mais. Peça um novo link ao setor de planejamento.", 404);
    const repo = repoServidor();
    const db = supabaseAdmin();
    const agora = new Date();

    // O mesmo envio chegando de novo (toque duplo, conexão que reenvia) devolve a corrida já gravada
    const chave = typeof corpo.chave_envio === "string" && /^[\w-]{8,80}$/.test(corpo.chave_envio) ? corpo.chave_envio : null;
    if (chave) {
      const { data: existente } = await db.from("corridas").select("*").eq("chave_envio", chave).eq("solicitante_id", sol.id).maybeSingle();
      if (existente) return respostaPedido(req, existente as Corrida, sol.nome);
    }

    const tipo = corpo.tipo === "agendada" ? "agendada" : "imediata";
    const quando = tipo === "agendada" ? new Date(corpo.data_hora) : agora;
    const maxDias = await numero(repo, "antecedencia_maxima_dias", 30);
    const origem = String(corpo.origem ?? "").trim().slice(0, 300);
    const destino = String(corpo.destino ?? "").trim().slice(0, 300);
    const motivo = String(corpo.motivo ?? "").trim().slice(0, 200);
    const qtd = Number(corpo.qtd_passageiros ?? 1);
    if (tipo === "agendada" && (isNaN(quando.getTime()) || quando.getTime() < agora.getTime() - 2 * 60_000)) return erroJson("Informe uma data e hora futuras.");
    if (quando.getTime() > agora.getTime() + maxDias * 86400_000) return erroJson(`Só é possível agendar até ${maxDias} dias à frente.`);
    if (origem.length < 3) return erroJson("Informe a origem.");
    if (destino.length < 3) return erroJson("Informe o destino.");
    if (motivo.length < 3) return erroJson("Informe o motivo.");
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return erroJson("Informe o número de passageiros (1 a 20).");
    const cc = corpo.centro_custo_id ? await repo.centroCusto(String(corpo.centro_custo_id)) : null;
    if (!cc?.ativo) return erroJson("Escolha o centro de custo.");

    // Mesmo trajeto pedido há menos de 2 minutos: devolve o pedido anterior em vez de duplicar
    const doisMin = new Date(agora.getTime() - 2 * 60_000).toISOString();
    const { data: recente } = await db.from("corridas").select("*").eq("solicitante_id", sol.id).eq("origem", origem).eq("destino", destino)
      .gte("criado_em", doisMin).neq("status", "cancelada").order("criado_em", { ascending: false }).limit(1);
    if (recente?.[0]) return respostaPedido(req, recente[0] as Corrida, sol.nome, "Este pedido já tinha sido registrado agora há pouco.");

    // Freio para link vazado ou uso indevido
    const limiteHora = await numero(repo, "limite_pedidos_hora", 6);
    const { count } = await db.from("corridas").select("id", { count: "exact", head: true }).eq("solicitante_id", sol.id)
      .gte("criado_em", new Date(agora.getTime() - 3600_000).toISOString());
    if ((count ?? 0) >= limiteHora) return erroJson(`Limite de ${limiteHora} pedidos por hora atingido. Se precisar de mais, fale com o planejamento.`, 429);

    const pontos = { origem_lat: num(corpo.origem_lat), origem_lng: num(corpo.origem_lng), destino_lat: num(corpo.destino_lat), destino_lng: num(corpo.destino_lng) };
    const distancia = pontos.origem_lat != null && pontos.origem_lng != null && pontos.destino_lat != null && pontos.destino_lng != null
      ? await distanciaTrajeto({ lat: pontos.origem_lat, lng: pontos.origem_lng }, { lat: pontos.destino_lat, lng: pontos.destino_lng }) : null;

    const corrida = await repo.criarCorrida({
      solicitante_id: sol.id, centro_custo_id: cc.id, tipo, data_hora_prevista: quando.toISOString(), origem, destino,
      qtd_passageiros: qtd, outros_passageiros: qtd > 1 ? String(corpo.outros_passageiros ?? "").trim().slice(0, 200) || null : null, motivo,
      ...pontos, ...(distancia != null ? { distancia_km: distancia } : {}), ...(chave ? { chave_envio: chave } : {}),
    });

    const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id);
    if (!forn) return respostaPedido(req, corrida, sol.nome);
    const { corrida: enviada, saidas } = await despachar(repo, corrida, forn, agora, "bot", `Enviada a ${forn.nome} (pedido pelo link, IP ${ipDe(req)})`);

    // Com a API oficial ligada, o envio é automático; sem ela, a pessoa envia pelo link (e-mails de aviso saem nos dois casos)
    const avisarTodas = String((await repo.parametro("avisar_planejamento_toda_corrida")) ?? "sim").trim().toLowerCase() !== "nao";
    const avisos = !avisarTodas ? [] : await avisarPlanejamento(repo, "nova_corrida_planejamento", [enviada.protocolo, sol.nome, tipo === "imediata" ? "agora" : formatarDataHora(enviada.data_hora_prevista), origem, destino, forn.nome], enviada.id);
    await despacharSaidas(db, [...(envioAutomatico() ? saidas : []), ...avisos]);
    return respostaPedido(req, enviada, sol.nome);
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
