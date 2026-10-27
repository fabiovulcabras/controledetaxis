/**
 * Tabela de preços combinados com o fornecedor (Cadastros › Tabela de preços).
 * Fora de Extrema o preço vale pela cidade; dentro, pelo bairro (linha sem bairro = resto da cidade).
 * Veículo e modalidade saem do número de passageiros. Só funções puras: o servidor descobre cidade e bairro
 * do endereço (lib/endereco.ts) e chama escolherPreco.
 */

export type Veiculo = "passeio" | "spin" | "van";
export type Modalidade = "unico" | "diversos" | "qualquer";
export type LinhaPreco = {
  id: string; fornecedor_id: string; localidade: string; cidade: string; uf?: string | null; bairro?: string | null; apelidos?: string | null;
  modalidade: Modalidade; veiculo: Veiculo; valor: number; ativo?: boolean;
};
/** Onde fica o ponto da corrida: cidade e bairros vindos do mapa (se houver) e o texto do endereço. */
export type Onde = { cidade?: string | null; bairros?: string[]; texto: string };
export type PrecoEscolhido = { linha: LinhaPreco; valor: number; descricao: string; veiculo: Veiculo; modalidade: Modalidade };

export const ROTULO_VEICULO: Record<Veiculo, string> = { passeio: "Passeio (4 lugares)", spin: "Spin (6 lugares)", van: "Van" };
export const ROTULO_MODALIDADE: Record<Modalidade, string> = { unico: "destino único", diversos: "diversos destinos", qualquer: "qualquer" };

export const normalizar = (t: string | null | undefined) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const contem = (texto: string, termo: string) => !!termo && ` ${texto} `.includes(` ${termo} `);

/** 1–4 passageiros: Passeio; 5–6: Spin; 7 ou mais: Van. */
export const veiculoPorPassageiros = (n: number): Veiculo => (n >= 7 ? "van" : n >= 5 ? "spin" : "passeio");
/** 1 passageiro: destino único; 2 ou mais: diversos destinos. */
export const modalidadePorPassageiros = (n: number): Exclude<Modalidade, "qualquer"> => (n >= 2 ? "diversos" : "unico");

/**
 * Escolhe a linha da tabela para o ponto da corrida:
 * 1. cidade: a do mapa, ou o nome da cidade dentro do texto do endereço;
 * 2. bairro: a linha cujo bairro (ou apelido) aparece no endereço; sem bairro reconhecido, a linha sem bairro (resto da cidade);
 * 3. veículo e modalidade pelos passageiros. Sem a modalidade exata, usa "qualquer" e, por último, a outra modalidade.
 */
export function escolherPreco(linhas: LinhaPreco[], onde: Onde, passageiros: number): PrecoEscolhido | null {
  const veiculo = veiculoPorPassageiros(passageiros);
  const modalidade = modalidadePorPassageiros(passageiros);
  const texto = normalizar(onde.texto);
  const cidadeMapa = normalizar(onde.cidade);
  const tudo = normalizar([...(onde.bairros ?? []), onde.texto].join(" "));
  const ativas = linhas.filter((l) => l.ativo !== false);

  const daCidade = ativas.filter((l) => (cidadeMapa ? normalizar(l.cidade) === cidadeMapa : false));
  // Sem cidade do mapa (ou cidade fora da tabela), procura o nome da cidade no texto; a mais longa ganha ("São José dos Campos" antes de "São Paulo")
  const candidatas = daCidade.length ? daCidade : (() => {
    const achadas = ativas.filter((l) => contem(texto, normalizar(l.cidade)));
    const maior = Math.max(0, ...achadas.map((l) => normalizar(l.cidade).length));
    return achadas.filter((l) => normalizar(l.cidade).length === maior);
  })();
  if (!candidatas.length) return null;

  const termos = (l: LinhaPreco) => [l.bairro, ...String(l.apelidos ?? "").split(",")].map(normalizar).filter(Boolean);
  const doBairro = candidatas.filter((l) => l.bairro && termos(l).some((t) => contem(tudo, t)));
  const base = doBairro.length ? doBairro : candidatas.filter((l) => !l.bairro);
  const doVeiculo = base.filter((l) => l.veiculo === veiculo);
  const linha = doVeiculo.find((l) => l.modalidade === modalidade) ?? doVeiculo.find((l) => l.modalidade === "qualquer") ?? doVeiculo[0];
  if (!linha) return null;
  return {
    linha, valor: Number(linha.valor), veiculo, modalidade: linha.modalidade,
    descricao: `${linha.localidade} · ${ROTULO_VEICULO[veiculo]}${linha.modalidade !== "qualquer" ? ` · ${ROTULO_MODALIDADE[linha.modalidade]}` : ""}`,
  };
}

/**
 * Qual ponta da corrida define o preço: o destino, a não ser que o destino seja uma unidade da empresa
 * (volta para o CD); nesse caso, a origem.
 */
export function pontoDoPreco(c: { origem: string; destino: string }, nomesUnidades: string[]): "origem" | "destino" {
  const destino = normalizar(c.destino);
  return nomesUnidades.some((n) => normalizar(n) && destino.startsWith(normalizar(n))) ? "origem" : "destino";
}

// ------------------------------------------------------------------ Importação da planilha
const lerNumero = (t: string) => {
  const s = String(t ?? "").replace(/[R$\s]/g, "");
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
export function lerModalidade(t: string): Modalidade | null {
  const n = normalizar(t);
  if (!n || n === "qualquer" || n === "todos") return "qualquer";
  if (n.includes("diversos") || n.includes("varios")) return "diversos";
  if (n.includes("unico")) return "unico";
  return null;
}
export function lerVeiculo(t: string): Veiculo | null {
  const n = normalizar(t);
  if (/van|15|16/.test(n)) return "van";
  if (/spin|6 lugares|^6$/.test(n)) return "spin";
  if (/passeio|carro|comum|4 lugares|^4$|sedan/.test(n)) return "passeio";
  return null;
}
export const COLUNAS_PLANILHA = ["Fornecedor", "Localidade", "Cidade", "UF", "Bairro", "Apelidos", "Modalidade", "Veículo", "Valor"];

/**
 * Lê a planilha de preços no formato de COLUNAS_PLANILHA (o mesmo que o painel exporta).
 * Fornecedor pelo nome cadastrado; Bairro vazio = cidade toda; Modalidade: destino único, diversos destinos ou vazio (qualquer);
 * Veículo: Passeio, Spin ou Van.
 */
export function lerTabelaPrecos(linhas: string[][], fornecedores: { id: string; nome: string }[]): { itens: Omit<LinhaPreco, "id">[]; erros: string[] } {
  const erros: string[] = [];
  const itens: Omit<LinhaPreco, "id">[] = [];
  const validas = linhas.filter((l) => l.some((c) => String(c ?? "").trim()));
  if (!validas.length) return { itens, erros: ["A planilha está vazia."] };
  const cab = validas[0].map(normalizar);
  const col = (nome: string) => cab.findIndex((c) => c === normalizar(nome) || c.startsWith(normalizar(nome)));
  const idx = Object.fromEntries(COLUNAS_PLANILHA.map((c) => [c, col(c)]));
  for (const obrig of ["Fornecedor", "Cidade", "Veículo", "Valor"]) {
    if (idx[obrig] < 0) return { itens, erros: [`Falta a coluna "${obrig}". Use as colunas: ${COLUNAS_PLANILHA.join(", ")}.`] };
  }
  const pegar = (l: string[], c: string) => (idx[c] >= 0 ? String(l[idx[c]] ?? "").trim() : "");
  validas.slice(1).forEach((l, i) => {
    const n = i + 2;
    const nomeForn = pegar(l, "Fornecedor");
    const forn = fornecedores.find((f) => normalizar(f.nome) === normalizar(nomeForn))
      ?? fornecedores.find((f) => normalizar(nomeForn) && normalizar(f.nome).includes(normalizar(nomeForn)));
    const cidade = pegar(l, "Cidade");
    const veiculo = lerVeiculo(pegar(l, "Veículo"));
    const modalidade = lerModalidade(pegar(l, "Modalidade"));
    const valor = lerNumero(pegar(l, "Valor"));
    if (!forn) { erros.push(`Linha ${n}: fornecedor "${nomeForn}" não cadastrado.`); return; }
    if (!cidade) { erros.push(`Linha ${n}: falta a cidade.`); return; }
    if (!veiculo) { erros.push(`Linha ${n}: veículo "${pegar(l, "Veículo")}" não reconhecido (use Passeio, Spin ou Van).`); return; }
    if (!modalidade) { erros.push(`Linha ${n}: modalidade "${pegar(l, "Modalidade")}" não reconhecida (destino único, diversos destinos ou vazio).`); return; }
    if (valor == null) { erros.push(`Linha ${n}: valor "${pegar(l, "Valor")}" inválido.`); return; }
    const bairro = pegar(l, "Bairro") || null;
    itens.push({
      fornecedor_id: forn.id, localidade: pegar(l, "Localidade") || [cidade, bairro].filter(Boolean).join(" - "), cidade, uf: pegar(l, "UF") || null,
      bairro, apelidos: pegar(l, "Apelidos") || null, modalidade, veiculo, valor, ativo: true,
    });
  });
  return { itens, erros };
}
