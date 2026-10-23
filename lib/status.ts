// Status da corrida e transições permitidas. Espelha fn_transicao_valida em supabase/schema.sql.
export type StatusCorrida =
  | "solicitada" | "enviada" | "aceita" | "recusada" | "sem_resposta"
  | "em_andamento" | "concluida" | "cancelada" | "validada" | "contestada";

export type OrigemEvento = "bot" | "fornecedor" | "planejamento" | "sistema";

export const STATUS: Record<StatusCorrida, { rotulo: string; ajuda: string }> = {
  solicitada: { rotulo: "Solicitada", ajuda: "Gravada pelo bot, ainda não enviada ao fornecedor" },
  enviada: { rotulo: "Aguardando fornecedor", ajuda: "Enviada ao fornecedor, prazo de resposta correndo" },
  aceita: { rotulo: "Aceita", ajuda: "Fornecedor confirmou; aguardando embarque" },
  recusada: { rotulo: "Recusada", ajuda: "Fornecedor não atende; pode ser reenviada" },
  sem_resposta: { rotulo: "Sem resposta", ajuda: "Prazo estourado sem resposta do fornecedor" },
  em_andamento: { rotulo: "Em andamento", ajuda: "Passageiro embarcou" },
  concluida: { rotulo: "Concluída", ajuda: "Realizada, valor informado; aguarda validação" },
  cancelada: { rotulo: "Cancelada", ajuda: "Não será realizada" },
  validada: { rotulo: "Validada", ajuda: "Conferida pelo planejamento; liberada para pagamento" },
  contestada: { rotulo: "Contestada", ajuda: "Divergência de valor ou corrida questionada" },
};

export const ORDEM_STATUS = Object.keys(STATUS) as StatusCorrida[];

const TRANSICOES: Record<StatusCorrida, StatusCorrida[]> = {
  solicitada: ["enviada", "cancelada"],
  enviada: ["enviada", "aceita", "recusada", "sem_resposta", "cancelada"],
  aceita: ["em_andamento", "concluida", "cancelada"],
  recusada: ["enviada", "cancelada"],
  sem_resposta: ["enviada", "aceita", "recusada", "cancelada"],
  em_andamento: ["concluida", "cancelada"],
  concluida: ["validada", "contestada"],
  contestada: ["validada", "concluida"],
  validada: ["contestada"],
  cancelada: [],
};

export const transicaoValida = (de: StatusCorrida, para: StatusCorrida) => TRANSICOES[de].includes(para);

/** Status em que a corrida ainda pode ser cancelada pelo solicitante ou pelo planejamento. */
export const CANCELAVEIS: StatusCorrida[] = ["solicitada", "enviada", "aceita", "recusada", "sem_resposta", "em_andamento"];
/** Status que pedem atenção do planejamento. */
export const EXCECOES: StatusCorrida[] = ["recusada", "sem_resposta", "contestada"];
