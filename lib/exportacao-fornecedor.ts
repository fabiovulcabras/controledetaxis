// Relação de corridas que o fornecedor baixa pelo portal, num intervalo de datas.
import { dataSP } from "./datas";

/** Maior intervalo aceito numa exportação (em dias, contando o primeiro e o último). */
export const MAX_DIAS_EXPORTACAO = 366;

const lerDia = (s: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? { ano, mes, dia } : null;
};

/**
 * Converte "AAAA-MM-DD" (data inicial e final, no horário de São Paulo) em instantes:
 * do início do primeiro dia até o início do dia seguinte ao último (exclusivo).
 */
export function periodoExportacao(de: string | null, ate: string | null): { inicio: Date; fim: Date } | { erro: string } {
  const a = lerDia(de), b = lerDia(ate);
  if (!a || !b) return { erro: "Informe a data inicial e a final." };
  const inicio = dataSP(a.ano, a.mes, a.dia);
  const fim = dataSP(b.ano, b.mes, b.dia + 1);
  if (fim <= inicio) return { erro: "A data final não pode ser anterior à inicial." };
  if ((fim.getTime() - inicio.getTime()) / 86400_000 > MAX_DIAS_EXPORTACAO) return { erro: `Escolha um intervalo de até ${MAX_DIAS_EXPORTACAO} dias.` };
  return { inicio, fim };
}
