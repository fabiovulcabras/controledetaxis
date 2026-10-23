import { lerValor } from "./datas";

export type ItemFatura = { data_corrida: string | null; protocolo_informado: string | null; descricao: string | null; valor: number };

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Divide uma linha CSV respeitando aspas. */
function dividir(linha: string, sep: string): string[] {
  const out: string[] = []; let atual = ""; let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (ch === sep && !aspas) { out.push(atual); atual = ""; }
    else atual += ch;
  }
  out.push(atual);
  return out.map((c) => c.trim());
}

function lerData(t: string): string | null {
  const s = t.trim();
  // Data gravada como número de série do Excel (dias desde 30/12/1899)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400_000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Lê a fatura do fornecedor em CSV (exportado do Excel). Colunas reconhecidas pelo cabeçalho:
 * data, protocolo, descrição, valor. Sem cabeçalho, usa essa ordem. Separador ; , ou tabulação.
 */
export function lerFaturaCsv(texto: string): { itens: ItemFatura[]; erros: string[] } {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { itens: [], erros: ["O arquivo está vazio."] };
  const sep = [";", "\t", ","].map((s) => [s, linhas[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  return lerFaturaLinhas(linhas.map((l) => dividir(l, sep)));
}

/** Mesma leitura a partir de linhas já separadas em colunas (usada também para .xlsx). */
export function lerFaturaLinhas(linhasBrutas: string[][]): { itens: ItemFatura[]; erros: string[] } {
  const linhas = linhasBrutas.map((l) => l.map((c) => String(c ?? "").trim())).filter((l) => l.some(Boolean));
  if (!linhas.length) return { itens: [], erros: ["O arquivo está vazio."] };
  const cab = linhas[0].map(semAcento);
  const achar = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c.includes(n)));
  const temCabecalho = cab.some((c) => /protocolo|valor|data/.test(c));
  const col = temCabecalho
    ? { data: achar("data"), protocolo: achar("protocolo", "referencia"), descricao: achar("descri", "trajeto", "obs"), valor: achar("valor", "total") }
    : { data: 0, protocolo: 1, descricao: 2, valor: 3 };
  if (col.valor < 0) return { itens: [], erros: ["Não encontrei a coluna de valor. Use as colunas data; protocolo; descrição; valor."] };

  const itens: ItemFatura[] = []; const erros: string[] = [];
  linhas.slice(temCabecalho ? 1 : 0).forEach((c, i) => {
    const valor = lerValor((c[col.valor] ?? "").replace(/\s/g, ""));
    if (valor == null) { erros.push(`Linha ${i + (temCabecalho ? 2 : 1)}: valor "${c[col.valor] ?? ""}" não reconhecido.`); return; }
    itens.push({
      data_corrida: col.data >= 0 ? lerData(c[col.data] ?? "") : null,
      protocolo_informado: col.protocolo >= 0 ? (c[col.protocolo] || "").toUpperCase() || null : null,
      descricao: col.descricao >= 0 ? c[col.descricao] || null : null,
      valor,
    });
  });
  return { itens, erros };
}

/** Gera CSV com ; (abre direto no Excel em português). */
export function gerarCsv(linhas: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
}
