import type { Corrida, Fornecedor, Repo, Saida } from "./tipos";
import type { OrigemEvento } from "../status";
import { brl, formatarDataHora, formatarHora } from "../datas";
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

/** Fornecedores ativos que atendem o trecho (com tabela de preços, só onde há preço), pela prioridade. */
async function quemAtende(repo: Repo, c: Corrida | null, excluir: Set<string> = new Set()): Promise<Fornecedor[]> {
  const ativos = (await repo.fornecedoresAtivos()).filter((f) => !excluir.has(f.id)).sort((a, b) => a.prioridade - b.prioridade);
  if (!c) return ativos;
  const atende: Fornecedor[] = [];
  for (const f of ativos) if (await repo.fornecedorAtende(f.id, c).catch(() => true)) atende.push(f);
  return atende;
}

/**
 * Escolhe o fornecedor: o padrão do solicitante, senão o ativo de maior prioridade. Com a corrida informada,
 * pula quem não atende o trecho (fornecedor com tabela de preços sem valor para aquele local).
 */
export async function escolherFornecedor(repo: Repo, fornecedorPadraoId?: string | null, c: Corrida | null = null): Promise<Fornecedor | null> {
  if (fornecedorPadraoId) {
    const f = await repo.fornecedor(fornecedorPadraoId);
    if (f?.ativo && (!c || await repo.fornecedorAtende(f.id, c).catch(() => true))) return f;
  }
  return (await quemAtende(repo, c))[0] ?? null;
}

/** Envia a corrida ao fornecedor (status Enviada, prazo de resposta) e monta o modelo com os botões Aceitar/Recusar. */
export async function despachar(repo: Repo, c: Corrida, forn: Fornecedor, agora: Date, origem: OrigemEvento, obs?: string): Promise<{ corrida: Corrida; saidas: Saida[] }> {
  const minutos = c.tipo === "agendada" ? await numero(repo, "prazo_agendada_min", 120) : forn.prazo_resposta_min || 10;
  const prazo = new Date(agora.getTime() + minutos * 60_000);
  // Corrida que muda de fornecedor ganha link novo: o link antigo deixa de valer
  const trocou = !!c.fornecedor_id && c.fornecedor_id !== forn.id;
  const tentados = [...new Set([...(c.fornecedores_tentados ?? []), ...(c.fornecedor_id ? [c.fornecedor_id] : []), forn.id])];
  const atual = await repo.mudarStatus(c.id, "enviada", origem, obs ?? `Enviada a ${forn.nome}`, {
    fornecedor_id: forn.id, prazo_resposta_em: prazo.toISOString(), fornecedores_tentados: tentados,
    ...(trocou ? { token_fornecedor: novoToken() } : {}),
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

/** Próximo fornecedor ativo, pela prioridade, que ainda não recebeu esta corrida e atende o trecho. */
export async function proximoFornecedor(repo: Repo, c: Corrida): Promise<Fornecedor | null> {
  const tentados = new Set([...(c.fornecedores_tentados ?? []), ...(c.fornecedor_id ? [c.fornecedor_id] : [])]);
  return (await quemAtende(repo, c, tentados))[0] ?? null;
}

/**
 * Reenvio automático (parâmetro reenvio_automatico): passa a corrida recusada ou sem resposta ao próximo fornecedor.
 * Devolve null quando está desligado ou não sobrou fornecedor; nesse caso o planejamento trata pelo painel.
 */
export async function reenviarAutomatico(repo: Repo, c: Corrida, agora: Date): Promise<{ corrida: Corrida; fornecedor: Fornecedor; saidas: Saida[] } | null> {
  const ligado = String((await repo.parametro("reenvio_automatico")) ?? "sim").trim().toLowerCase();
  if (ligado === "nao" || ligado === "não") return null;
  const forn = await proximoFornecedor(repo, c);
  if (!forn) return null;
  const r = await despachar(repo, c, forn, agora, "sistema", `Reenviada automaticamente a ${forn.nome}`);
  return { corrida: r.corrida, fornecedor: forn, saidas: r.saidas };
}

/** Valor esperado do trajeto pela tarifa do fornecedor (bandeirada + km), quando há distância estimada. */
export function valorEsperado(c: Pick<Corrida, "distancia_km">, forn: Fornecedor | null): number | null {
  if (!forn || c.distancia_km == null || forn.valor_km == null) return null;
  return Math.round((Number(forn.bandeirada ?? 0) + Number(forn.valor_km) * Number(c.distancia_km)) * 100) / 100;
}

/** Confere o valor informado contra o teto do centro de custo, a tarifa do trajeto e o limite mensal da pessoa. */
export async function verificarValor(repo: Repo, c: Corrida, valor: number, agora: Date): Promise<Saida[]> {
  const problemas: string[] = [];
  const cc = c.centro_custo_id ? await repo.centroCusto(c.centro_custo_id) : null;
  if (cc?.teto_por_corrida && valor > Number(cc.teto_por_corrida)) problemas.push(`valor ${brl(valor)} acima do teto de ${brl(Number(cc.teto_por_corrida))} do ${cc.codigo}`);
  const forn = c.fornecedor_id ? await repo.fornecedor(c.fornecedor_id) : null;
  // Tabela de preços combinada com o fornecedor: valor acima dela é sempre apontado ao planejamento
  const tabela = await repo.precoTabela(c).catch(() => null);
  if (tabela && valor > tabela.valor + 0.005) problemas.push(`valor ${brl(valor)} acima da tabela: ${brl(tabela.valor)} (${tabela.descricao})`);
  const esperado = tabela ? null : valorEsperado(c, forn);
  const tolerancia = await numero(repo, "tolerancia_trajeto_pct", 30);
  if (esperado != null && valor > esperado * (1 + tolerancia / 100)) {
    problemas.push(`valor ${brl(valor)} acima do esperado para ${Number(c.distancia_km).toFixed(1)} km (${brl(esperado)})`);
  }
  const sol = await repo.solicitante(c.solicitante_id);
  if (sol?.limite_mensal) {
    const gasto = await repo.gastoDoMes(sol.id, agora);
    if (gasto > Number(sol.limite_mensal)) problemas.push(`${sol.nome} passou do limite mensal: ${brl(gasto)} de ${brl(Number(sol.limite_mensal))}`);
  }
  const saidas: Saida[] = [];
  for (const p of problemas) saidas.push(...await alertar(repo, c, p));
  return saidas;
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

/**
 * Prazo vencido sem resposta: o fornecedor perde a vez (Sem resposta) e, com reenvio, a corrida vai ao próximo da fila.
 * Sem próximo fornecedor (ou sem reenvio), o planejamento é alertado e o solicitante avisado.
 * Usado pelo QStash (/api/qstash/prazo, uma corrida no instante do prazo) e pelo agendador (/api/cron/prazos, rede de segurança).
 */
export async function tratarPrazoVencido(repo: Repo, c: Corrida, agora: Date, opcoes: { reenviar?: boolean } = {}): Promise<Saida[]> {
  const forn = c.fornecedor_id ? await repo.fornecedor(c.fornecedor_id) : null;
  const atual = await repo.mudarStatus(c.id, "sem_resposta", "sistema", `Prazo de resposta vencido${forn ? ` (${forn.nome} perdeu a vez)` : ""}`);
  const r = opcoes.reenviar ? await reenviarAutomatico(repo, atual, agora) : null;
  if (r) {
    return [...r.saidas, ...await avisarSolicitante(repo, r.corrida,
      `O fornecedor ${forn?.nome ?? ""} não respondeu à corrida ${c.protocolo}. Enviamos a ${r.fornecedor.nome}.`, `sem resposta; enviada a ${r.fornecedor.nome}`)];
  }
  return [
    ...await alertar(repo, atual, opcoes.reenviar ? "sem resposta no prazo e nenhum outro fornecedor disponível na fila" : "sem resposta do fornecedor no prazo"),
    ...await avisarSolicitante(repo, atual,
      `O fornecedor ${forn?.nome ?? ""} ainda não respondeu à corrida ${c.protocolo}. O planejamento foi avisado e vai providenciar outro fornecedor.`,
      "fornecedor sem resposta; o planejamento foi avisado"),
  ];
}

/** Marca como Sem resposta as corridas cujo prazo venceu. Rodado pelo agendador (/api/cron/prazos). */
export async function verificarPrazos(repo: Repo, agora: Date, opcoes: { reenviar?: boolean } = {}): Promise<Saida[]> {
  const saidas: Saida[] = [];
  for (const c of await repo.corridasComPrazoVencido(agora)) {
    try { saidas.push(...await tratarPrazoVencido(repo, c, agora, opcoes)); }
    catch (err) { console.error("Prazo da corrida", c.protocolo, err instanceof Error ? err.message : err); } // ex.: tratada ao mesmo tempo pelo QStash
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
