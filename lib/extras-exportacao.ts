// Proposta de roteirização de uma extra em Excel: uma linha por colaborador, na ordem do percurso de cada carro.
import type { CelulaXlsx, ColunaXlsx } from "./xlsx";

export type CarroProposta = {
  veiculo: string; passageiros: number; paradas: number; km: number | null; km_estimado: boolean;
  valor: number | null; fornecedor: string | null; descricao_preco: string | null;
  pessoas: { id: string; nome: string; endereco: string; bairro: string | null; cidade: string | null; uf: string | null; localizacao: string }[];
};
export type DadosColaborador = { codigo: string; endereco: string | null; cep: string | null };
export type Proposta = {
  sentido: "entrada" | "saida"; unidade: string;
  /** Valor do campo datetime-local (AAAA-MM-DDTHH:MM); vazio quando ainda não informado. */
  quando: string;
  carros: CarroProposta[];
  colaboradores: Map<string, DadosColaborador>;
};

export const COLUNAS_PROPOSTA: ColunaXlsx[] = [
  { titulo: "Carro", largura: 8, formato: "inteiro" },
  { titulo: "Veículo", largura: 10 },
  { titulo: "Ordem no percurso", largura: 18, formato: "inteiro" },
  { titulo: "Código", largura: 12 },
  { titulo: "Colaborador", largura: 36 },
  { titulo: "Endereço", largura: 44 },
  { titulo: "Bairro", largura: 24 },
  { titulo: "Cidade", largura: 22 },
  { titulo: "UF", largura: 6 },
  { titulo: "CEP", largura: 12 },
  { titulo: "Localização no mapa", largura: 20 },
  { titulo: "Passageiros no carro", largura: 20, formato: "inteiro" },
  { titulo: "Paradas", largura: 9, formato: "inteiro" },
  { titulo: "Km do carro", largura: 13, formato: "decimal" },
  { titulo: "Tipo de km", largura: 12 },
  { titulo: "Valor do carro", largura: 15, formato: "moeda" },
  { titulo: "Fornecedor", largura: 22 },
  { titulo: "Preço da tabela", largura: 36 },
  { titulo: "Sentido", largura: 10 },
  { titulo: "Unidade", largura: 24 },
  { titulo: "Data e hora", largura: 17 },
];

const ROTULO_VEICULO: Record<string, string> = { passeio: "Passeio", spin: "Spin", van: "Van" };

const dataHora = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : "";
};

/** Km e valor aparecem só na primeira linha de cada carro, para a soma da coluna no Excel dar o total certo. */
export function linhasDaProposta(p: Proposta): CelulaXlsx[][] {
  return p.carros.flatMap((c, i) => c.pessoas.map((x, ordem) => {
    const cad = p.colaboradores.get(x.id);
    const primeira = ordem === 0;
    return [
      i + 1, ROTULO_VEICULO[c.veiculo] ?? c.veiculo, ordem + 1, cad?.codigo, x.nome,
      cad?.endereco ?? x.endereco, x.bairro, x.cidade, x.uf, cad?.cep, x.localizacao,
      c.passageiros, c.paradas,
      primeira ? c.km : null, c.km == null ? "" : c.km_estimado ? "Estimado" : "Real",
      primeira ? c.valor : null, c.fornecedor, c.valor == null ? "Sem preço na tabela" : c.descricao_preco,
      p.sentido === "saida" ? "Saída" : "Entrada", p.unidade, dataHora(p.quando),
    ];
  }));
}

export function nomeArquivoProposta(sentido: Proposta["sentido"], quando: string, hoje = new Date()): string {
  const dia = /^\d{4}-\d{2}-\d{2}/.exec(quando)?.[0]
    ?? [hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  return `roteirizacao-extra-${sentido}-${dia}.xlsx`;
}
