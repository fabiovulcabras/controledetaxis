import { supabaseAdmin } from "@/lib/supabase-admin";
import { escolherFornecedor, despachar, avisarPlanejamento, numero } from "@/lib/bot/acoes";
import { enviarSaidas, modoEnvio } from "@/lib/whatsapp/transporte";
import { linkWhatsApp, msgNovaCorridaFornecedor, urlApp } from "@/lib/whatsapp/link";
import { repoServidor, solicitantePorToken, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { CANCELAVEIS, STATUS } from "@/lib/status";
import { formatarDataHora } from "@/lib/datas";

export const dynamic = "force-dynamic";
const MOTIVOS = ["Visita a cliente", "Viagem / aeroporto", "Hora extra", "Visita a fornecedor"];

/** Dados para a página de pedido: quem é, opções do formulário e as últimas corridas. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  try {
    const sol = await solicitantePorToken(token);
    if (!sol) return erroJson("Este link não vale mais. Peça um novo link ao setor de planejamento.", 404);
    const repo = repoServidor();
    const db = supabaseAdmin();
    const base = urlApp(req);
    const [unidade, centros, maxDias, recentes] = await Promise.all([
      sol.unidade_id ? repo.unidade(sol.unidade_id) : null,
      repo.centrosCusto(sol.unidade_id),
      numero(repo, "antecedencia_maxima_dias", 30),
      db.from("corridas").select("*, fornecedores(nome,telefone_whatsapp)").eq("solicitante_id", sol.id).order("criado_em", { ascending: false }).limit(10),
    ]);
    return Response.json({
      nome: sol.nome,
      endereco_unidade: unidade?.endereco_padrao ? `${unidade.nome} · ${unidade.endereco_padrao}` : null,
      centros: centros.map((c) => ({ id: c.id, rotulo: `${c.codigo} · ${c.descricao}` })),
      centro_padrao: sol.centro_custo_padrao_id ?? null,
      motivos: MOTIVOS,
      max_dias: maxDias,
      corridas: (recentes.data ?? []).map((c: any) => ({
        id: c.id, protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status as keyof typeof STATUS]?.rotulo ?? c.status,
        quando: formatarDataHora(c.data_hora_prevista), origem: c.origem, destino: c.destino, fornecedor: c.fornecedores?.nome ?? null,
        motorista: [c.motorista, c.veiculo_placa, c.eta_minutos ? `${c.eta_minutos} min` : null].filter(Boolean).join(" · ") || null,
        pode_cancelar: CANCELAVEIS.includes(c.status),
        // Enquanto o fornecedor não respondeu, a pessoa pode reenviar a mensagem pelo WhatsApp
        whatsapp_fornecedor: ["enviada", "sem_resposta"].includes(c.status) && c.fornecedores?.telefone_whatsapp
          ? linkWhatsApp(c.fornecedores.telefone_whatsapp, msgNovaCorridaFornecedor(c, sol.nome, base)) : null,
      })),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Grava o pedido, envia ao fornecedor e devolve o link de WhatsApp com a mensagem pronta. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
  try {
    const sol = await solicitantePorToken(corpo.token);
    if (!sol) return erroJson("Este link não vale mais. Peça um novo link ao setor de planejamento.", 404);
    const repo = repoServidor();
    const agora = new Date();

    const tipo = corpo.tipo === "agendada" ? "agendada" : "imediata";
    const quando = tipo === "agendada" ? new Date(corpo.data_hora) : agora;
    const maxDias = await numero(repo, "antecedencia_maxima_dias", 30);
    const origem = String(corpo.origem ?? "").trim();
    const destino = String(corpo.destino ?? "").trim();
    const motivo = String(corpo.motivo ?? "").trim();
    const qtd = Number(corpo.qtd_passageiros ?? 1);
    if (tipo === "agendada" && (isNaN(quando.getTime()) || quando.getTime() < agora.getTime() - 2 * 60_000)) return erroJson("Informe uma data e hora futuras.");
    if (quando.getTime() > agora.getTime() + maxDias * 86400_000) return erroJson(`Só é possível agendar até ${maxDias} dias à frente.`);
    if (origem.length < 3) return erroJson("Informe a origem.");
    if (destino.length < 3) return erroJson("Informe o destino.");
    if (motivo.length < 3) return erroJson("Informe o motivo.");
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return erroJson("Informe o número de passageiros (1 a 20).");
    const cc = corpo.centro_custo_id ? await repo.centroCusto(String(corpo.centro_custo_id)) : null;
    if (!cc?.ativo) return erroJson("Escolha o centro de custo.");

    const corrida = await repo.criarCorrida({
      solicitante_id: sol.id, centro_custo_id: cc.id, tipo, data_hora_prevista: quando.toISOString(), origem, destino,
      qtd_passageiros: qtd, outros_passageiros: qtd > 1 ? String(corpo.outros_passageiros ?? "").trim() || null : null, motivo,
      origem_lat: Number.isFinite(corpo.origem_lat) ? corpo.origem_lat : null, origem_lng: Number.isFinite(corpo.origem_lng) ? corpo.origem_lng : null,
      destino_lat: Number.isFinite(corpo.destino_lat) ? corpo.destino_lat : null, destino_lng: Number.isFinite(corpo.destino_lng) ? corpo.destino_lng : null,
    });

    const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id);
    if (!forn) return Response.json({ protocolo: corrida.protocolo, fornecedor: null, aviso: "Não há fornecedor ativo cadastrado. O planejamento vai providenciar." });
    const { corrida: enviada, saidas } = await despachar(repo, corrida, forn, agora, "bot", `Enviada a ${forn.nome} (pedido pelo link)`);

    // Com a API oficial ligada, o envio é automático; sem ela, a pessoa envia pelo link
    const oficial = modoEnvio() === "whatsapp";
    if (oficial) {
      const avisos = await avisarPlanejamento(repo, "nova_corrida_planejamento", [enviada.protocolo, sol.nome, tipo === "imediata" ? "agora" : formatarDataHora(enviada.data_hora_prevista), origem, destino, forn.nome], enviada.id);
      await enviarSaidas(supabaseAdmin(), [...saidas, ...avisos], "whatsapp");
    }
    return Response.json({
      protocolo: enviada.protocolo, fornecedor: forn.nome, envio_automatico: oficial,
      whatsapp: linkWhatsApp(forn.telefone_whatsapp, msgNovaCorridaFornecedor(enviada, sol.nome, urlApp(req))),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
