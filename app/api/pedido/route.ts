import { precisaCodigo, respostaCodigo } from "@/lib/acesso-solicitante";
import { trajetoTexto } from "@/lib/multidestino";
import { otimizarDestinos } from "@/lib/km-corrida";
import { MAX_DESTINOS } from "@/lib/multidestino";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { escolherFornecedor, despachar, numero } from "@/lib/bot/acoes";
import { despacharSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { linkWhatsApp, msgNovaCorridaFornecedor, urlApp } from "@/lib/whatsapp/link";
import { dentroDoLimite, ipDe, muitasTentativas, repoServidor, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { CANCELAVEIS_SOLICITANTE, STATUS } from "@/lib/status";
import { formatarDataHora } from "@/lib/datas";
import { locaisDoPedido } from "@/lib/locais";
import type { Corrida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";
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
    if (await precisaCodigo(req, sol as any)) return respostaCodigo();
    const repo = repoServidor();
    const db = supabaseAdmin();
    const base = urlApp(req);
    const [locais, maxDias, recentes] = await Promise.all([
      locaisDoPedido(db, sol.unidade_id),
      numero(repo, "antecedencia_maxima_dias", 30),
      db.from("corridas").select("*, fornecedores(nome,telefone_whatsapp)").eq("solicitante_id", sol.id).order("criado_em", { ascending: false }).limit(20),
    ]);
    const lista = recentes.data ?? [];
    return Response.json({
      nome: sol.nome,
      locais,
      motivos: await repo.motivos(),
      max_dias: maxDias,
      retencao_meses: await numero(repo, "retencao_meses", 12),
      frequentes: frequentes(lista),
      corridas: lista.slice(0, 10).map((c: any) => ({
        id: c.id, protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status as keyof typeof STATUS]?.rotulo ?? c.status,
        quando: formatarDataHora(c.data_hora_prevista), origem: c.origem, destino: trajetoTexto(c), fornecedor: c.fornecedores?.nome ?? null,
        motorista: [c.motorista, c.veiculo_placa, c.eta_minutos ? `${c.eta_minutos} min` : null].filter(Boolean).join(" · ") || null,
        pode_cancelar: CANCELAVEIS_SOLICITANTE.includes(c.status),
        chegou: c.chegou_em ? formatarDataHora(c.chegou_em) : null,
        avaliacao: c.avaliacao ?? null,
        pode_avaliar: ["concluida", "validada", "contestada"].includes(c.status) && c.avaliacao == null && "avaliacao" in c,
        // Para o botão "Repetir": refaz o formulário com os mesmos dados
        repetir: {
          origem: c.origem, origem_lat: num(c.origem_lat), origem_lng: num(c.origem_lng), destino: c.destino, destino_lat: num(c.destino_lat), destino_lng: num(c.destino_lng),
          qtd_passageiros: c.qtd_passageiros, outros_passageiros: c.outros_passageiros ?? "", motivo: c.motivo, observacoes: c.observacoes ?? "",
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
    if (await precisaCodigo(req, sol as any)) return respostaCodigo();
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
    const observacoes = String(corpo.observacoes ?? "").trim().slice(0, 500) || null;
    const qtd = Number(corpo.qtd_passageiros ?? 1);
    if (tipo === "agendada" && (isNaN(quando.getTime()) || quando.getTime() < agora.getTime() - 2 * 60_000)) return erroJson("Informe uma data e hora futuras.");
    if (quando.getTime() > agora.getTime() + maxDias * 86400_000) return erroJson(`Só é possível agendar até ${maxDias} dias à frente.`);
    if (origem.length < 3) return erroJson("Informe a origem.");
    if (destino.length < 3) return erroJson("Informe o destino.");
    if (motivo.length < 3) return erroJson("Informe o motivo.");
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return erroJson("Informe o número de passageiros (1 a 20).");

    // Mesmo trajeto pedido há menos de 2 minutos: devolve o pedido anterior em vez de duplicar
    const doisMin = new Date(agora.getTime() - 2 * 60_000).toISOString();
    const { data: recente } = await db.from("corridas").select("*").eq("solicitante_id", sol.id).eq("origem", origem).eq("destino", destino)
      .gte("criado_em", doisMin).neq("status", "cancelada").order("criado_em", { ascending: false }).limit(1);
    if (recente?.[0] && !(Array.isArray(corpo.destinos_extras) && corpo.destinos_extras.length)) return respostaPedido(req, recente[0] as Corrida, sol.nome, "Este pedido já tinha sido registrado agora há pouco.");

    // Freio para link vazado ou uso indevido
    const limiteHora = await numero(repo, "limite_pedidos_hora", 6);
    const { count } = await db.from("corridas").select("id", { count: "exact", head: true }).eq("solicitante_id", sol.id)
      .gte("criado_em", new Date(agora.getTime() - 3600_000).toISOString());
    if ((count ?? 0) >= limiteHora) return erroJson(`Limite de ${limiteHora} pedidos por hora atingido. Se precisar de mais, fale com o planejamento.`, 429);

    // Vários destinos: o destino digitado e os extras. O app escolhe o final (o mais longe) e a ordem de menor km.
    const extras = (Array.isArray(corpo.destinos_extras) ? corpo.destinos_extras : []).slice(0, MAX_DESTINOS - 1)
      .map((x: any) => ({ texto: String(x?.texto ?? "").trim().slice(0, 300), lat: num(x?.lat), lng: num(x?.lng), google: !!x?.google }))
      .filter((x: { texto: string }) => x.texto.length >= 3);
    let destinoFinal = { texto: destino, lat: num(corpo.destino_lat), lng: num(corpo.destino_lng), google: !!corpo.destino_google };
    let paradas: { texto: string; lat: number | null; lng: number | null; google: boolean }[] = [];
    let rotaOtimizada: { km: number; fonte: string } | null = null;
    if (extras.length) {
      const todos = [destinoFinal, ...extras];
      const ot = await otimizarDestinos(db, { texto: origem, lat: num(corpo.origem_lat), lng: num(corpo.origem_lng) }, todos).catch(() => null);
      // Sem achar todos no mapa, vale a ordem digitada (o último é o final)
      const ordem = ot?.ordem ?? [...todos.keys()];
      destinoFinal = todos[ordem[ordem.length - 1]];
      paradas = ordem.slice(0, -1).map((i) => todos[i]);
      if (ot) rotaOtimizada = { km: ot.km, fonte: ot.fonte };
    }

    const pontos = { origem_lat: num(corpo.origem_lat), origem_lng: num(corpo.origem_lng), destino_lat: destinoFinal.lat, destino_lng: destinoFinal.lng };
    // Pontos vindos do Google Places servem para a distância e a tabela, mas não ficam gravados (termos do Google Maps)
    const doGoogle = {
      ...(corpo.origem_google ? { origem_lat: pontos.origem_lat, origem_lng: pontos.origem_lng } : {}),
      ...(destinoFinal.google ? { destino_lat: pontos.destino_lat, destino_lng: pontos.destino_lng } : {}),
    };
    const gravar = { ...pontos, ...Object.fromEntries(Object.keys(doGoogle).map((k) => [k, null])) };

    const corrida = await repo.criarCorrida({
      solicitante_id: sol.id, tipo, data_hora_prevista: quando.toISOString(), origem, destino: destinoFinal.texto,
      // Paradas: coordenadas do Google não ficam gravadas (o km é recalculado buscando o endereço)
      ...(paradas.length ? { paradas: paradas.map((x) => ({ texto: x.texto, lat: x.google ? null : x.lat, lng: x.google ? null : x.lng })) } : {}),
      qtd_passageiros: qtd, outros_passageiros: qtd > 1 ? String(corpo.outros_passageiros ?? "").trim().slice(0, 200) || null : null, motivo,
      ...(observacoes ? { observacoes } : {}),
      ...gravar,  ...(chave ? { chave_envio: chave } : {}),
    });
    Object.assign(corrida, doGoogle);

    // Km rodado: com vários destinos, o da rota otimizada; senão, a distância por ruas (Google Routes ou OpenRouteService)
    if (rotaOtimizada) {
      const campos = { distancia_km: rotaOtimizada.km, distancia_fonte: rotaOtimizada.fonte, distancia_calculada_em: new Date().toISOString() };
      const { error: eKm } = await db.from("corridas").update(campos).eq("id", corrida.id);
      if (!eKm) Object.assign(corrida, campos);
    } // destino único: o km é medido depois do envio ao fornecedor (despacharSaidas)
    const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id, corrida);
    if (!forn) return respostaPedido(req, corrida, sol.nome);
    const { corrida: enviada, saidas } = await despachar(repo, corrida, forn, agora, "bot", `Enviada a ${forn.nome} (pedido pelo link, IP ${ipDe(req)})`);

    // WhatsApp sai sozinho só com envio automático (Meta ou Evolution); a notificação push sai sempre
    await despacharSaidas(db, saidas);
    return respostaPedido(req, enviada, sol.nome);
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
