// Fechamento mensal por espelho: rótulos e regras usadas no painel e no portal do fornecedor.
export type StatusEspelho = "aguardando" | "contestado" | "aprovado" | "nf_enviada" | "pago";
export const STATUS_ESPELHO: Record<StatusEspelho, { rotulo: string; portal: string; tag: string }> = {
  aguardando: { rotulo: "Aguardando o fornecedor", portal: "Conferir e aprovar", tag: "pendente" },
  contestado: { rotulo: "Contestado pelo fornecedor", portal: "Em análise pelo planejamento", tag: "reprovada" },
  aprovado: { rotulo: "Aprovado · aguardando NF", portal: "Aprovado · envie a NF", tag: "aprovada" },
  nf_enviada: { rotulo: "NF recebida · aguardando pagamento", portal: "NF enviada · aguardando pagamento", tag: "aprovada" },
  pago: { rotulo: "Pago", portal: "Pago", tag: "aprovada" },
};
export const ORIGEM_BASE: Record<string, string> = { tabela: "Tabela", informado: "Informado", sem_valor: "Sem valor" };

/** "2026-10" -> "10/2026" */
export const nomeCompetencia = (c: string) => { const [a, m] = c.split("-"); return `${m}/${a}`; };
/** Mês anterior ao de `d`, no formato da competência. */
export function competenciaAnterior(d = new Date()): string {
  const l = new Date(d.getTime() - 3 * 3600_000);
  const a = l.getUTCFullYear(), m = l.getUTCMonth(); // m: 0-11 do mês atual => mês anterior = m (1-12) do ano certo
  return m === 0 ? `${a - 1}-12` : `${a}-${String(m).padStart(2, "0")}`;
}

/** Quanto foi glosado num item: o que o fornecedor pediu (informado + extras lançados) menos o valor final. */
export function glosaItem(i: { valor_informado: number | null; valor_base: number; valor_final: number }, extrasPedidos: number): number {
  const pedido = (i.valor_informado ?? i.valor_base) + extrasPedidos;
  return Math.max(0, Math.round((pedido - i.valor_final) * 100) / 100);
}
