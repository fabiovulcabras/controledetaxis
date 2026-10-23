import type { Corrida, Fornecedor, Repo, Saida } from "./tipos";
import type { OrigemEvento } from "../status";
import { formatarDataHora, formatarHora } from "../datas";
import { textoTemplate } from "../whatsapp/templates";

const URL_PAINEL = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const linkCorrida = (c: Corrida) => (URL_PAINEL ? `${URL_PAINEL}/corridas?id=${c.id}` : "");

/** 64 caracteres aleatórios (mesmo formato de fn_novo_token no banco). */
export const novoToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");

export async function numero(repo: Repo, chave: string, padrao: number): Promise<number> {
  const v = Number(String((await repo.parametro(chave)) ?? "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

export async function telefonesPlanejamento(repo: Repo): Promise<string[]> {
  return String((await repo.parametro("planejamento_telefones")) ?? "")
    .split(/[,;\s]+/).map((t) => t.replace(/\D/g, "")).filter((t) => t.length >= 10);
}

/** Template ao planejamento (sempre modelo: o bot inicia a conversa). */
export async function avisarPlanejamento(repo: Repo, template: string, parametros: string[], corridaId?: string): Promise<Saida[]> {
  const texto = textoTemplate(template, parametros);
  return (await telefonesPlanejamento(repo)).map((para) => ({ para, texto, corridaId, template: { nome: template, parametros, sempre: true } }));
}

/** Alerta de exceção ao planejamento. */
export async function alertar(repo: Repo, c: Corrida, problema: string): Promise<Saida[]> {
  const sol = await repo.solicitante(c.solicitante_id);
  const forn = c.fornecedor_id ? await repo.fornecedor(c.fornecedor_id) : null;
  const link = linkCorrida(c);
  return avisarPlanejamento(repo, "alerta_corrida_planejamento",
    [c.protocolo, problema + (link ? ` (${link})` : ""), sol?.nome ?? "-", forn?.nome ?? "-"], c.id);
}

/** Mensagem ao solicitante: texto livre se a janela estiver aberta, senão o modelo genérico de atualização. */
export async function avisarSolicitante(repo: Repo, c: Corrida, texto: string, resumo: string): Promise<Saida[]> {
  const sol = await repo.solicitante(c.solicitante_id);
  if (!sol) return [];
  return [{ para: sol.telefone_whatsapp, texto, corridaId: c.id, template: { nome: "atualizacao_corrida_solicitante", parametros: [c.protocolo, resumo] } }];
}

/** Escolhe o fornecedor: o padrão do solicitante, senão o ativo de maior prioridade. */
export async function escolherFornecedor(repo: Repo, fornecedorPadraoId?: string | null): Promise<Fornecedor | null> {
  if (fornecedorPadraoId) {
    const f = await repo.fornecedor(fornecedorPadraoId);
    if (f?.ativo) return f;
  }
  return (await repo.fornecedoresAtivos()).sort((a, b) => a.prioridade - b.prioridade)[0] ?? null;
}

/** Envia a corrida ao fornecedor (status Enviada, prazo de resposta) e monta o modelo com os botões Aceitar/Recusar. */
export async function despachar(repo: Repo, c: Corrida, forn: Fornecedor, agora: Date, origem: OrigemEvento, obs?: string): Promise<{ corrida: Corrida; saidas: Saida[] }> {
  const minutos = c.tipo === "agendada" ? await numero(repo, "prazo_agendada_min", 120) : forn.prazo_resposta_min || 10;
  const prazo = new Date(agora.getTime() + minutos * 60_000);
  // Corrida que muda de fornecedor ganha link novo: o link antigo deixa de valer
  const trocou = !!c.fornecedor_id && c.fornecedor_id !== forn.id;
  const atual = await repo.mudarStatus(c.id, "enviada", origem, obs ?? `Enviada a ${forn.nome}`, {
    fornecedor_id: forn.id, prazo_resposta_em: prazo.toISOString(), ...(trocou ? { token_fornecedor: novoToken() } : {}),
  });
  const sol = await repo.solicitante(c.solicitante_id);
  const parametros = [
    c.protocolo, sol?.nome ?? "-", c.tipo === "imediata" ? `agora (${formatarHora(c.data_hora_prevista)})` : formatarDataHora(c.data_hora_prevista),
    c.origem, c.destino, String(c.qtd_passageiros), formatarHora(prazo),
  ];
  return {
    corrida: atual,
    saidas: [{
      para: forn.telefone_whatsapp, corridaId: c.id, texto: textoTemplate("nova_corrida_fornecedor", parametros),
      opcoes: [{ id: `ACEITAR:${c.protocolo}`, titulo: "Aceitar" }, { id: `RECUSAR:${c.protocolo}`, titulo: "Recusar" }],
      template: { nome: "nova_corrida_fornecedor", parametros, botoes: [`ACEITAR:${c.protocolo}`, `RECUSAR:${c.protocolo}`], sempre: true },
    }],
  };
}

/** Cancela e avisa quem precisa saber. */
export async function cancelarCorrida(repo: Repo, c: Corrida, motivo: string, origem: OrigemEvento, opcoes: { avisarSolicitante?: boolean } = {}): Promise<{ corrida: Corrida; saidas: Saida[] }> {
  const antes = c.status;
  const atual = await repo.mudarStatus(c.id, "cancelada", origem, motivo, { motivo_cancelamento: motivo });
  const saidas: Saida[] = [];
  if (c.fornecedor_id && ["enviada", "aceita", "em_andamento", "sem_resposta"].includes(antes) && origem !== "fornecedor") {
    const forn = await repo.fornecedor(c.fornecedor_id);
    if (forn) {
      const parametros = [c.protocolo, formatarDataHora(c.data_hora_prevista), c.origem, motivo];
      saidas.push({ para: forn.telefone_whatsapp, corridaId: c.id, texto: textoTemplate("corrida_cancelada_fornecedor", parametros), template: { nome: "corrida_cancelada_fornecedor", parametros, sempre: true } });
    }
  }
  if (opcoes.avisarSolicitante) saidas.push(...await avisarSolicitante(repo, c, `Sua corrida ${c.protocolo} foi cancelada. Motivo: ${motivo}.`, `cancelada (${motivo})`));
  if (["aceita", "em_andamento"].includes(antes) && origem !== "planejamento") {
    saidas.push(...await alertar(repo, atual, `cancelada depois do aceite (${motivo})`));
  }
  return { corrida: atual, saidas };
}

/** Marca como Sem resposta as corridas cujo prazo venceu. Rodado pelo agendador (/api/cron/prazos). */
export async function verificarPrazos(repo: Repo, agora: Date): Promise<Saida[]> {
  const saidas: Saida[] = [];
  for (const c of await repo.corridasComPrazoVencido(agora)) {
    const forn = c.fornecedor_id ? await repo.fornecedor(c.fornecedor_id) : null;
    const atual = await repo.mudarStatus(c.id, "sem_resposta", "sistema", "Prazo de resposta do fornecedor vencido");
    saidas.push(...await alertar(repo, atual, "sem resposta do fornecedor no prazo"));
    saidas.push(...await avisarSolicitante(repo, atual,
      `O fornecedor ${forn?.nome ?? ""} ainda não respondeu à corrida ${c.protocolo}. O planejamento foi avisado e vai providenciar outro fornecedor.`,
      "fornecedor sem resposta; o planejamento foi avisado"));
  }
  return saidas;
}

/** Lembra o solicitante das corridas agendadas que estão chegando. */
export async function enviarLembretes(repo: Repo, agora: Date): Promise<Saida[]> {
  const antecedencia = await numero(repo, "lembrete_antecedencia_min", 60);
  const saidas: Saida[] = [];
  for (const c of await repo.corridasParaLembrete(agora, new Date(agora.getTime() + antecedencia * 60_000))) {
    const sol = await repo.solicitante(c.solicitante_id);
    await repo.mudarStatus(c.id, null, "sistema", "Lembrete enviado ao solicitante", { lembrete_enviado_em: agora.toISOString() });
    if (!sol) continue;
    const parametros = [c.protocolo, formatarDataHora(c.data_hora_prevista), c.origem];
    saidas.push({ para: sol.telefone_whatsapp, corridaId: c.id, texto: textoTemplate("lembrete_corrida_solicitante", parametros), template: { nome: "lembrete_corrida_solicitante", parametros } });
  }
  return saidas;
}
