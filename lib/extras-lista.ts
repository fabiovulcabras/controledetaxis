/**
 * Lista de colaboradores colada ou enviada em planilha → colaboradores do cadastro.
 * Cada linha pode ser o código (matrícula) ou o nome; o nome vale se for igual ao do cadastro ou se só um colaborador o contiver.
 */
import { normalizar } from "./precos";

export type ColabLista = { id: string; codigo: string; nome: string };
export type ResultadoLista<T extends ColabLista> = {
  achados: T[];
  /** Linhas que não bateram com ninguém. */
  naoAchados: string[];
  /** Linhas que bateram com mais de um colaborador: o planejamento escolhe pelo campo de busca. */
  ambiguos: { texto: string; opcoes: T[] }[];
  /** Linhas que já estavam na lista da extra, ou repetidas. */
  repetidos: number;
};

/** Divide o texto colado em linhas de nomes/códigos (uma por linha, ou separadas por ; ou tab). */
export function linhasDaLista(texto: string): string[] {
  return texto.split(/[\r\n;\t]+/).map((l) => l.trim()).filter(Boolean);
}

export function casarLista<T extends ColabLista>(entradas: string[], cadastro: T[], jaEscolhidos: Set<string> = new Set()): ResultadoLista<T> {
  const r: ResultadoLista<T> = { achados: [], naoAchados: [], ambiguos: [], repetidos: 0 };
  const porCodigo = new Map(cadastro.map((c) => [c.codigo.replace(/^0+(?=\d)/, ""), c]));
  const porNome = new Map<string, T[]>();
  const nomes = cadastro.map((c) => ({ c, n: normalizar(c.nome) }));
  for (const { c, n } of nomes) porNome.set(n, [...(porNome.get(n) ?? []), c]);
  const vistos = new Set(jaEscolhidos);
  const aceitar = (c: T) => { if (vistos.has(c.id)) r.repetidos++; else { vistos.add(c.id); r.achados.push(c); } };
  for (const bruto of entradas) {
    const texto = bruto.trim();
    if (!texto) continue;
    if (/^\d+(\.0+)?$/.test(texto)) {
      const c = porCodigo.get(texto.replace(/\.0+$/, "").replace(/^0+(?=\d)/, ""));
      if (c) aceitar(c); else r.naoAchados.push(texto);
      continue;
    }
    const n = normalizar(texto);
    if (!n) continue;
    const exatos = porNome.get(n);
    if (exatos?.length === 1) { aceitar(exatos[0]); continue; }
    if (exatos && exatos.length > 1) { r.ambiguos.push({ texto, opcoes: exatos.slice(0, 5) }); continue; }
    const termos = n.split(" ");
    const parecidos = nomes.filter((x) => termos.every((t) => ` ${x.n} `.includes(` ${t} `) || x.n.includes(t))).map((x) => x.c);
    if (parecidos.length === 1) aceitar(parecidos[0]);
    else if (parecidos.length > 1) r.ambiguos.push({ texto, opcoes: parecidos.slice(0, 5) });
    else r.naoAchados.push(texto);
  }
  return r;
}
