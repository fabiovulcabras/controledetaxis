import { dataSP, partesSP } from "./datas";

/**
 * Dados obrigatórios para o fornecedor confirmar a corrida: nome do motorista, placa válida e horário de chegada.
 * Funções puras, usadas pelo bot e pela página do fornecedor.
 */

/** Placa no padrão antigo (ABC1234) ou Mercosul (ABC1D23): 7 caracteres. Devolve normalizada ou null. */
export function placaValida(texto: string | null | undefined): string | null {
  const p = String(texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{3}\d{4}$/.test(p) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(p) ? p : null;
}

/** ABC1234 → "ABC-1234"; Mercosul fica como está (ABC1D23). */
export const formatarPlaca = (p: string) => (/^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

/** 17:30 → "17h30". */
export function formatarHora(d: Date): string {
  const p = partesSP(d);
  return `${String(p.hora).padStart(2, "0")}h${String(p.minuto).padStart(2, "0")}`;
}

export type Chegada = { em: Date; minutos: number };
export type ErroChegada = { erro: string };

/**
 * Horário de chegada digitado ("17h30", "17:30", "17h") → instante e minutos a partir de agora.
 * Corrida imediata: o horário mais próximo de agora, que não pode já ter passado nem ficar a mais de 6 h.
 * Corrida agendada: o horário mais próximo do horário marcado.
 */
export function lerChegada(hora: number, minuto: number, agora: Date, referencia?: Date | null, agendada = false): Chegada | ErroChegada {
  if (!(hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59)) return { erro: "horário inválido" };
  const ref = agendada && referencia && referencia > agora ? referencia : agora;
  const p = partesSP(ref);
  const candidatos = [-1, 0, 1].map((d) => new Date(dataSP(p.ano, p.mes, p.dia, hora, minuto).getTime() + d * 86400_000));
  const em = candidatos.sort((a, b) => Math.abs(a.getTime() - ref.getTime()) - Math.abs(b.getTime() - ref.getTime()))[0];
  const minutos = Math.round((em.getTime() - agora.getTime()) / 60_000);
  if (minutos < -2) return { erro: `o horário ${formatarHora(em)} já passou` };
  if (!agendada && minutos > 360) return { erro: `${formatarHora(em)} está a mais de 6 horas` };
  return { em, minutos: Math.max(0, minutos) };
}

/** "17h30", "17:30", "17 h 30", "17h" dentro de um texto. */
export function acharHorario(texto: string): { trecho: string; hora: number; minuto: number } | null {
  const m = texto.match(/(?<![\d])([01]?\d|2[0-3])\s*(?:h|hs|:)\s*([0-5]\d)?(?![\d])/i);
  return m ? { trecho: m[0], hora: Number(m[1]), minuto: Number(m[2] ?? 0) } : null;
}

export type DadosMotorista = { motorista: string; veiculo_placa: string; eta_minutos: number; chegada: Date };

/**
 * Lê "Carlos Souza, RTX4F21, 17h30" e confere tudo. Devolve os dados prontos, ou a lista do que falta/está errado.
 */
/** dados preenchido só quando está tudo certo; senão, problemas lista o que falta. */
export function lerDadosMotorista(texto: string, agora: Date, referencia?: Date | null, agendada = false): { ok: boolean; dados: DadosMotorista | null; problemas: string[] } {
  const t = String(texto ?? "").trim();
  const problemas: string[] = [];
  let resto = t;

  // Candidata a placa: 3 letras + 4 caracteres com algum número (não confunde com nomes); depois confere o padrão
  const placaTxt = t.match(/(?<![A-Za-z0-9])([A-Za-z]{3})[\s-]?((?=[A-Za-z]*\d)[A-Za-z0-9]{4})(?![A-Za-z0-9])/);
  const placa = placaTxt ? placaValida(placaTxt[1] + placaTxt[2]) : null;
  if (placaTxt) resto = resto.replace(placaTxt[0], " ");
  if (!placaTxt) problemas.push("a placa do carro (ex.: ABC1234 ou ABC1D23)");
  else if (!placa) problemas.push(`uma placa válida — "${placaTxt[0]}" não segue o padrão antigo (ABC1234) nem o Mercosul (ABC1D23)`);

  const hora = acharHorario(resto);
  let chegada: Chegada | null = null;
  if (hora) {
    resto = resto.replace(hora.trecho, " ");
    const c = lerChegada(hora.hora, hora.minuto, agora, referencia, agendada);
    if ("erro" in c) problemas.push(`um horário de chegada válido — ${c.erro}`);
    else chegada = c;
  } else {
    problemas.push("o horário de chegada (ex.: 17h30)");
  }

  const nome = resto.replace(/\b(placa|motorista|carro|chega(?:da)?|chegando|previs[aã]o|hor[aá]rio|às|as|em)\b/gi, " ")
    .replace(/[,;|\-–:.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(nome)) problemas.push("o nome do motorista");

  if (problemas.length || !placa || !chegada) return { ok: false, dados: null, problemas };
  return { ok: true, dados: { motorista: nome, veiculo_placa: placa, eta_minutos: chegada.minutos, chegada: chegada.em }, problemas: [] };
}

/** "chegada prevista às 17h30 (em cerca de 15 min)". */
export function textoChegada(chegada: Date, agora: Date): string {
  const min = Math.max(0, Math.round((chegada.getTime() - agora.getTime()) / 60_000));
  return `chegada prevista às ${formatarHora(chegada)}${min > 0 && min <= 360 ? ` (em cerca de ${min} min)` : ""}`;
}
