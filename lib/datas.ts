// Datas no fuso de São Paulo. O Brasil não tem horário de verão desde 2019, então o deslocamento é fixo em -03:00.
// Se o horário de verão voltar, troque estas funções por Intl.DateTimeFormat com timeZone "America/Sao_Paulo".
const OFFSET_MS = 3 * 60 * 60 * 1000;

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; diaSemana: number };

/** Componentes da data no horário de São Paulo. */
export function partesSP(d: Date): Partes {
  const l = new Date(d.getTime() - OFFSET_MS);
  return { ano: l.getUTCFullYear(), mes: l.getUTCMonth() + 1, dia: l.getUTCDate(), hora: l.getUTCHours(), minuto: l.getUTCMinutes(), diaSemana: l.getUTCDay() };
}

/** Cria um instante a partir de uma data/hora de São Paulo. */
export function dataSP(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, hora, minuto) + OFFSET_MS);
}

const dois = (n: number) => String(n).padStart(2, "0");

/** "24/10 07:30" */
export function formatarDataHora(d: Date | string): string {
  const p = partesSP(new Date(d));
  return `${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "24/10/2026" */
export function formatarData(d: Date | string): string {
  const p = partesSP(new Date(d));
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano}`;
}

/** "07:30" */
export function formatarHora(d: Date | string): string {
  const p = partesSP(new Date(d));
  return `${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "2026-10" do instante, no horário de São Paulo. */
export function competencia(d: Date): string {
  const p = partesSP(d);
  return `${p.ano}-${dois(p.mes)}`;
}

/** Início do dia de hoje em São Paulo. */
export function inicioDoDiaSP(d: Date): Date {
  const p = partesSP(d);
  return dataSP(p.ano, p.mes, p.dia);
}

/** Início do mês em São Paulo. */
export function inicioDoMesSP(d: Date): Date {
  const p = partesSP(d);
  return dataSP(p.ano, p.mes, 1);
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Lê data e hora digitadas pelo solicitante. Aceita:
 * "24/10 07:30", "24/10/2026 7h30", "hoje 18:00", "amanhã 7h", "amanha às 6:15", "18h40" (hoje).
 * Devolve null quando não entende o texto.
 */
export function lerDataHora(texto: string, agora: Date): Date | null {
  const t = semAcento(texto).replace(/\s+as\s+|\s+a\s+/g, " ");
  const hm = t.match(/(\d{1,2})\s*(?::|h)\s*(\d{2})?\s*(?:h|min)?\b/);
  const hojeP = partesSP(agora);

  let ano = hojeP.ano, mes = hojeP.mes, dia = hojeP.dia;
  const dmy = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dmy) {
    dia = Number(dmy[1]); mes = Number(dmy[2]);
    if (dmy[3]) ano = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    else if (dataSP(ano, mes, dia, 23, 59) < agora) ano += 1; // "05/01" digitado em dezembro = ano que vem
  } else if (/\bamanha\b/.test(t)) {
    const amanha = new Date(dataSP(hojeP.ano, hojeP.mes, hojeP.dia, 12).getTime() + 24 * 3600 * 1000);
    const p = partesSP(amanha); ano = p.ano; mes = p.mes; dia = p.dia;
  } else if (!/\bhoje\b/.test(t) && !hm) {
    return null;
  }

  if (!hm) return null;
  const hora = Number(hm[1]); const minuto = Number(hm[2] ?? 0);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;
  const d = dataSP(ano, mes, dia, hora, minuto);
  const conferir = partesSP(d);
  if (conferir.dia !== dia || conferir.mes !== mes) return null; // 31/02 e afins
  return d;
}

/** Lê um valor em reais: "68,50", "R$ 68.50", "68". */
export function lerValor(texto: string): number | null {
  const limpo = texto.replace(/r\$\s*/i, "").trim();
  const m = limpo.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const inteiro = Number(m[1].replace(/\./g, ""));
  const centavos = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return Math.round((inteiro + centavos / 100) * 100) / 100;
}

export const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
