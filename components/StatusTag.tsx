import { STATUS, type StatusCorrida } from "@/lib/status";

export function StatusTag({ status }: { status: StatusCorrida }) {
  return <span className={`tag st-${status}`} title={STATUS[status]?.ajuda}>{STATUS[status]?.rotulo ?? status}</span>;
}

export const SITUACOES: Record<string, string> = {
  conciliado: "Conciliado", divergente: "Valor divergente", sem_valor: "Sem valor informado", sem_protocolo: "Sem protocolo",
  cancelada: "Corrida cancelada", duplicado: "Cobrança duplicada", outro_fornecedor: "Outro fornecedor",
};

export function SituacaoTag({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span className="tag">A conciliar</span>;
  return <span className={`tag sit-${situacao}`}>{SITUACOES[situacao] ?? situacao}</span>;
}
