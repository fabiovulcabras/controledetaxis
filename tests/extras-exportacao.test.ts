import { describe, expect, it } from "vitest";
import { COLUNAS_PROPOSTA, linhasDaProposta, nomeArquivoProposta, type Proposta } from "../lib/extras-exportacao";

const pessoa = (id: string) => ({ id, nome: `Pessoa ${id}`, endereco: "Rua A", bairro: "Centro", cidade: "Extrema", uf: "MG", localizacao: "endereço" });
const proposta: Proposta = {
  sentido: "saida", unidade: "Galpão", quando: "2026-11-28T22:00",
  colaboradores: new Map([["1", { codigo: "100", endereco: "Rua A, 1", cep: "37640-000" }]]),
  carros: [{ veiculo: "spin", passageiros: 2, paradas: 1, km: 12.5, km_estimado: false, valor: 40, fornecedor: "F", descricao_preco: "Centro", pessoas: [pessoa("1"), pessoa("2")] }],
};

describe("exportação da proposta de roteirização", () => {
  it("gera uma linha por colaborador, com km e valor só na primeira do carro", () => {
    const linhas = linhasDaProposta(proposta);
    const col = (t: string) => COLUNAS_PROPOSTA.findIndex((c) => c.titulo === t);
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.length === COLUNAS_PROPOSTA.length)).toBe(true);
    expect(linhas.map((l) => l[col("Valor do carro")])).toEqual([40, null]);
    expect(linhas.map((l) => l[col("Km do carro")])).toEqual([12.5, null]);
    expect(linhas[0][col("Código")]).toBe("100");
    expect(linhas[0][col("Data e hora")]).toBe("28/11/2026 22:00");
  });
  it("usa a data da corrida no nome do arquivo, ou a de hoje", () => {
    expect(nomeArquivoProposta("saida", "2026-11-28T22:00")).toBe("roteirizacao-extra-saida-2026-11-28.xlsx");
    expect(nomeArquivoProposta("entrada", "", new Date(2026, 10, 27))).toBe("roteirizacao-extra-entrada-2026-11-27.xlsx");
  });
});
