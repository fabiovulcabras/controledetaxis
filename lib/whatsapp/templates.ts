/**
 * Modelos de mensagem (templates) a cadastrar na Meta, categoria Utilidade, idioma pt_BR.
 * O texto precisa ser idêntico ao aprovado. Variáveis {{1}}, {{2}}… na ordem dos parâmetros.
 * Mensagens que iniciam conversa (fornecedor, planejamento) só saem como modelo; as demais
 * usam o modelo apenas quando a janela de 24 h com a pessoa já fechou.
 */
export type DefinicaoTemplate = { corpo: string; botoes?: string[]; uso: string };

export const TEMPLATES: Record<string, DefinicaoTemplate> = {
  nova_corrida_fornecedor: {
    corpo: "Nova solicitação de táxi {{1}}.\nSolicitante: {{2}}\nQuando: {{3}}\nOrigem: {{4}}\nDestino: {{5}}\nPassageiros: {{6}}\nResponda até {{7}}.",
    botoes: ["Aceitar", "Recusar"],
    uso: "Fornecedor recebe uma corrida nova (botões de resposta rápida).",
  },
  corrida_cancelada_fornecedor: {
    corpo: "A corrida {{1}} ({{2}}, saindo de {{3}}) foi cancelada. Motivo: {{4}}.",
    uso: "Fornecedor é avisado de um cancelamento.",
  },
  nova_corrida_planejamento: {
    corpo: "Corrida {{1}} registrada. {{2}} pediu táxi para {{3}}, de {{4}} para {{5}}. Fornecedor: {{6}}.",
    uso: "Planejamento é avisado de cada corrida (parâmetro avisar_planejamento_toda_corrida).",
  },
  alerta_corrida_planejamento: {
    corpo: "Atenção na corrida {{1}}: {{2}}. Solicitante: {{3}}. Fornecedor: {{4}}.",
    uso: "Exceções: recusa, sem resposta, valor acima do teto, cancelamento após aceite, número não autorizado.",
  },
  atualizacao_corrida_solicitante: {
    corpo: "Atualização da sua corrida {{1}}: {{2}}",
    uso: "Qualquer aviso ao solicitante quando a janela de 24 h fechou (aceite, recusa, sem resposta).",
  },
  lembrete_corrida_solicitante: {
    corpo: "Lembrete: sua corrida {{1}} está agendada para {{2}}, saindo de {{3}}.",
    uso: "Lembrete antes de corrida agendada.",
  },
};

/** Texto do modelo com as variáveis preenchidas (para o histórico). */
export function textoTemplate(nome: string, parametros: string[]): string {
  const def = TEMPLATES[nome];
  if (!def) return parametros.join(" · ");
  return def.corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => parametros[Number(n) - 1] ?? "");
}

/** A Meta recusa parâmetros com quebra de linha, tabulação ou mais de 4 espaços seguidos. */
export const limparParametro = (p: string) => String(p ?? "").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim() || "-";
