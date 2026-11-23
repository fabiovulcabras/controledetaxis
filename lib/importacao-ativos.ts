/**
 * Importação de Ativos (Cadastros › Importação de Ativos).
 * O RH envia a planilha de colaboradores ativos; comparada com o cadastro (tabela colaboradores), ela mostra
 * quem é novo (cadastrar), quem voltou (reativar) e quem não veio (alerta de possível desligamento, que o
 * planejamento confirma). Só funções puras: a tela lê a planilha, busca o cadastro e grava o resultado.
 */
import { normalizar } from "./precos";
import { normalizarCep, ufDoCep } from "./cep";

export type Ativo = {
  codigo: string; nome: string; cargo: string | null; setor: string | null;
  /** AAAA-MM-DD */
  admissao: string | null; situacao: string | null;
  /** Endereço de casa (rua e número), bairro, cidade, UF (pelo CEP, a planilha não traz) e CEP só com dígitos. */
  endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
  /** AAAA-MM-DD; só vem se a planilha tiver a coluna Nascimento. */
  nascimento: string | null;
};
export type Colaborador = Ativo & { id: string; ativo: boolean };

/** Colunas do modelo enviado pelo RH. Só Código e Nome são obrigatórias. */
export const COLUNAS_ATIVOS = ["Código", "Nome", "Cargo", "Nome Lotacao", "Admissao", "Situacao", "Endereco", "Bairro", "Cidade", "CEP", "Nascimento"] as const;
type ColunaAtivos = (typeof COLUNAS_ATIVOS)[number];

/** Código como texto estável: 15000923, "15000923" e "15000923.0" viram a mesma coisa. */
export function normalizarCodigo(valor: string | null | undefined): string {
  const t = String(valor ?? "").trim();
  return /^\d+(\.0+)?$/.test(t) ? t.replace(/\.0+$/, "").replace(/^0+(?=\d)/, "") : t;
}

/** Data da célula: número de série do Excel (45376) ou texto dd/mm/aaaa ou aaaa-mm-dd. */
export function lerDataCelula(valor: string | null | undefined): string | null {
  const t = String(valor ?? "").trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n < 1 || n > 80_000) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function lerAtivos(linhas: string[][]): { registros: Ativo[]; erros: string[]; avisos: string[] } {
  const registros: Ativo[] = [];
  const erros: string[] = [];
  const avisos: string[] = [];
  const validas = linhas.filter((l) => l.some((c) => String(c ?? "").trim()));
  if (!validas.length) return { registros, erros: ["A planilha está vazia."], avisos };
  const cab = validas[0].map(normalizar);
  const achar = (c: ColunaAtivos) => cab.indexOf(normalizar(c));
  const idx = Object.fromEntries(COLUNAS_ATIVOS.map((c) => [c, achar(c)])) as Record<ColunaAtivos, number>;
  if (idx.Nascimento < 0) idx.Nascimento = Math.max(cab.indexOf("data nascimento"), cab.indexOf("data de nascimento"), cab.indexOf("dt nascimento"));
  for (const obrig of ["Código", "Nome"] as const) {
    if (idx[obrig] < 0) return { registros, erros: [`Falta a coluna "${obrig}". Use o mesmo modelo da planilha de ativos (colunas: ${COLUNAS_ATIVOS.join(", ")}).`], avisos };
  }
  const pegar = (l: string[], c: ColunaAtivos) => (idx[c] >= 0 ? String(l[idx[c]] ?? "").trim() : "");
  const vistos = new Set<string>();
  validas.slice(1).forEach((l, i) => {
    const n = i + 2;
    const codigo = normalizarCodigo(pegar(l, "Código"));
    const nome = pegar(l, "Nome");
    if (!codigo && !nome) return;
    if (!codigo) { erros.push(`Linha ${n}: falta o código de ${nome}.`); return; }
    if (!nome) { erros.push(`Linha ${n}: falta o nome do código ${codigo}.`); return; }
    if (vistos.has(codigo)) { avisos.push(`Linha ${n}: código ${codigo} repetido na planilha (${nome}); vale a primeira linha.`); return; }
    vistos.add(codigo);
    const admissao = pegar(l, "Admissao");
    if (admissao && !lerDataCelula(admissao)) avisos.push(`Linha ${n}: admissão "${admissao}" não reconhecida (${nome}); ficará em branco.`);
    const cepBruto = pegar(l, "CEP");
    const cep = normalizarCep(cepBruto);
    const cidade = pegar(l, "Cidade");
    if (cepBruto && !cep) avisos.push(`Linha ${n}: CEP "${cepBruto}" inválido (${nome}); ficará em branco.`);
    registros.push({
      codigo, nome, cargo: pegar(l, "Cargo") || null, setor: pegar(l, "Nome Lotacao") || null,
      admissao: lerDataCelula(admissao), situacao: pegar(l, "Situacao") || null,
      endereco: pegar(l, "Endereco") || null, bairro: pegar(l, "Bairro") || null, cidade: cidade || null, uf: ufDoCep(cep), cep,
      nascimento: lerDataCelula(pegar(l, "Nascimento")),
    });
  });
  return { registros, erros, avisos };
}

export type ResultadoComparacao = {
  /** Código que não existe no cadastro: cadastrar. */
  novos: Ativo[];
  /** Estava desligado no cadastro e voltou na planilha: reativar. */
  reativar: (Ativo & { id: string })[];
  /** Ativo no cadastro, mas fora da planilha: possível desligamento, a confirmar. */
  ausentes: Colaborador[];
  /** Ativo nos dois lados, com nome, cargo, setor, admissão ou situação diferentes: atualizar. */
  atualizar: (Ativo & { id: string })[];
  iguais: number;
};

const mesmosDados = (a: Ativo, b: Ativo) =>
  a.nome === b.nome && (a.cargo ?? "") === (b.cargo ?? "") && (a.setor ?? "") === (b.setor ?? "")
  && (a.admissao ?? "") === (b.admissao ?? "") && (a.situacao ?? "") === (b.situacao ?? "")
  && (a.endereco ?? "") === (b.endereco ?? "") && (a.bairro ?? "") === (b.bairro ?? "") && (a.cidade ?? "") === (b.cidade ?? "")
  && (a.uf ?? "") === (b.uf ?? "") && (a.cep ?? "") === (b.cep ?? "")
  // Nascimento só conta se a planilha o trouxe: sem a coluna, o que já está no cadastro fica como está
  && (a.nascimento == null || a.nascimento === (b.nascimento ?? null));

/** O código do colaborador é a chave: o nome pode mudar (casamento, correção) sem virar "novo + ausente". */
export function compararAtivos(arquivo: Ativo[], cadastro: Colaborador[]): ResultadoComparacao {
  const porCodigo = new Map(cadastro.map((c) => [normalizarCodigo(c.codigo), c]));
  const naPlanilha = new Set(arquivo.map((a) => a.codigo));
  const r: ResultadoComparacao = { novos: [], reativar: [], ausentes: [], atualizar: [], iguais: 0 };
  for (const a of arquivo) {
    const existente = porCodigo.get(a.codigo);
    if (!existente) r.novos.push(a);
    else if (!existente.ativo) r.reativar.push({ ...a, id: existente.id });
    else if (!mesmosDados(a, existente)) r.atualizar.push({ ...a, id: existente.id });
    else r.iguais++;
  }
  r.ausentes = cadastro.filter((c) => c.ativo && !naPlanilha.has(normalizarCodigo(c.codigo)));
  return r;
}

/**
 * Planilha errada ou parcial faria metade da empresa parecer desligada. Avisa quando a planilha deixa de fora
 * mais de 30% dos colaboradores ativos do cadastro (com pelo menos 10 ausentes).
 */
export function planilhaSuspeita(ausentes: number, ativosNoCadastro: number): boolean {
  return ausentes >= 10 && ativosNoCadastro > 0 && ausentes / ativosNoCadastro > 0.3;
}
