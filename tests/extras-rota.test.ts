import { describe, expect, it } from "vitest";
import { ufDoCep, normalizarCep } from "../lib/cep";
import { CAPACIDADE, percurso, planejarExtras, type PessoaExtra, type TabelaFornecedor } from "../lib/extras-rota";
import type { LinhaPreco } from "../lib/precos";

const unidade = { lat: -22.854, lng: -46.318 };
const pessoa = (id: string, nome: string, cidade: string, bairro: string, lat: number | null, lng = 0): PessoaExtra => ({
  id, nome, endereco: `Rua ${id}`, bairro, cidade, uf: "MG", ponto: lat == null ? null : { lat, lng }, onde: { cidade, bairros: [bairro], texto: `Rua ${id} ${bairro} ${cidade}` },
});
const linha = (f: string, cidade: string, veiculo: LinhaPreco["veiculo"], modalidade: LinhaPreco["modalidade"], valor: number): LinhaPreco =>
  ({ id: `${f}${cidade}${veiculo}${modalidade}`, fornecedor_id: f, localidade: cidade, cidade, bairro: null, apelidos: null, modalidade, veiculo, valor, ativo: true });
const tabelas: TabelaFornecedor[] = [
  { id: "A", nome: "Reinaldo", linhas: [linha("A", "Toledo", "passeio", "unico", 80), linha("A", "Toledo", "passeio", "diversos", 100), linha("A", "Extrema", "passeio", "unico", 40), linha("A", "Extrema", "passeio", "diversos", 50)] },
  { id: "B", nome: "Manfre", linhas: [linha("B", "Toledo", "passeio", "unico", 90), linha("B", "Toledo", "passeio", "diversos", 95)] },
];

describe("CEP", () => {
  it("acha o estado e completa zeros", () => {
    expect(ufDoCep("37640000")).toBe("MG");
    expect(ufDoCep("1310100")).toBe("SP");
    expect(ufDoCep("69900-000")).toBe("AC");
    expect(ufDoCep("abc")).toBeNull();
    expect(normalizarCep("1310100")).toBe("01310100");
  });
});

describe("roteirização de extras", () => {
  const pessoas = [
    pessoa("1", "ANA", "Toledo", "Pereiras", -22.74, -46.37), pessoa("2", "BIA", "Toledo", "Centro", -22.745, -46.375), pessoa("3", "CARLA", "Toledo", "Centro", -22.75, -46.36),
    pessoa("4", "FABI", "Extrema", "Centro", -22.86, -46.32), pessoa("5", "GIL", "Extrema", "Ponte Nova", -22.87, -46.33),
  ];

  it("junta no fornecedor mais barato e usa menos carros que pessoas", () => {
    const carros = planejarExtras({ pessoas, unidade, tabelas, veiculoMaximo: "passeio", sentido: "saida" });
    expect(carros.length).toBeLessThan(pessoas.length);
    expect(carros.flatMap((c) => c.pessoas).map((p) => p.id).sort()).toEqual(["1", "2", "3", "4", "5"]);
    const total = carros.reduce((s, c) => s + (c.valor ?? 0), 0);
    expect(total).toBeLessThanOrEqual(95 + 50); // Toledo junto (Manfre) + Extrema junto (Reinaldo)
    expect(carros.every((c) => c.passageiros <= CAPACIDADE.passeio)).toBe(true);
  });

  it("respeita o veículo máximo", () => {
    const so = planejarExtras({ pessoas, unidade, tabelas, veiculoMaximo: "passeio", sentido: "saida" });
    expect(Math.max(...so.map((c) => c.passageiros))).toBeLessThanOrEqual(4);
  });

  it("na entrada o percurso é o inverso da saída", () => {
    const s = planejarExtras({ pessoas, unidade, tabelas, veiculoMaximo: "passeio", sentido: "saida" });
    const e = planejarExtras({ pessoas, unidade, tabelas, veiculoMaximo: "passeio", sentido: "entrada" });
    expect(e.map((c) => c.pessoas.map((p) => p.id))).toEqual(s.map((c) => [...c.pessoas].reverse().map((p) => p.id)));
    expect(percurso(e[0], unidade, "entrada").at(-1)).toEqual(unidade);
    expect(percurso(s[0], unidade, "saida")[0]).toEqual(unidade);
  });

  it("não junta quem não foi localizado nem quem não tem preço", () => {
    const sem = pessoa("9", "SEM LOCAL", "Extrema", "X", null);
    const longe = pessoa("8", "LONGE", "Cidade Sem Tabela", "Centro", -23.5, -46.6);
    const carros = planejarExtras({ pessoas: [...pessoas, sem, longe], unidade, tabelas, veiculoMaximo: "spin", sentido: "saida" });
    const semLocal = carros.find((c) => c.semLocal)!;
    expect(semLocal.pessoas.map((p) => p.id)).toEqual(["9"]);
    const semPreco = carros.find((c) => c.pessoas.some((p) => p.id === "8"))!;
    expect(semPreco.pessoas).toHaveLength(1);
    expect(semPreco.semPreco).toBe(true);
  });

  it("no máximo 10 endereços diferentes por carro", () => {
    const muitos = Array.from({ length: 14 }, (_, i) => pessoa(String(i + 10), `P${i}`, "Toledo", "Centro", -22.74 - i * 0.001, -46.37));
    const carros = planejarExtras({ pessoas: muitos, unidade, tabelas, veiculoMaximo: "van", sentido: "saida" });
    expect(carros.every((c) => c.paradas <= 10)).toBe(true);
  });
});

import { casarLista, linhasDaLista } from "../lib/extras-lista";
describe("lista de colaboradores", () => {
  const cad = [
    { id: "1", codigo: "15000923", nome: "ADERBAL BATISTA BORGES FILHO" }, { id: "2", codigo: "15001057", nome: "ADILSON DE MELO CARDOSO" },
    { id: "3", codigo: "15002069", nome: "ADRIANA DE OLIVEIRA MARTINS" }, { id: "4", codigo: "15001775", nome: "ADRIANA OLIVEIRA FERREIRA CLAUDINO" },
  ];
  it("casa por código, nome exato e nome único; separa ambíguos e não achados", () => {
    const r = casarLista(linhasDaLista("15000923\nadilson de melo cardoso\nAderbal\nadriana\nFulano Inexistente\n15000923"), cad);
    expect(r.achados.map((c) => c.id)).toEqual(["1", "2"]);
    expect(r.ambiguos[0].opcoes.map((c) => c.id)).toEqual(["3", "4"]);
    expect(r.naoAchados).toEqual(["Fulano Inexistente"]);
    expect(r.repetidos).toBe(2); // o código 15000923 digitado duas vezes e "Aderbal", que é a mesma pessoa
  });
  it("ignora quem já está na lista da extra", () => {
    expect(casarLista(["15001057"], cad, new Set(["2"])).achados).toHaveLength(0);
  });
});

describe("escala", () => {
  it("400 pessoas viram poucos carros, cada uma uma vez só", () => {
    const cidades = [["Extrema", -22.854, -46.318], ["Toledo", -22.74, -46.37], ["Vargem", -22.88, -46.4]] as const;
    const ps = Array.from({ length: 400 }, (_, i) => { const [c, la, ln] = cidades[i % 3]; return pessoa(String(i), `P${i}`, c, "Centro", la + ((i * 37) % 100) / 5000, ln + ((i * 53) % 100) / 5000); });
    const tab: TabelaFornecedor[] = [{ id: "A", nome: "A", linhas: ["Extrema", "Toledo", "Vargem"].flatMap((c) => [linha("A", c, "passeio", "unico", 50), linha("A", c, "passeio", "diversos", 60), linha("A", c, "spin", "diversos", 80), linha("A", c, "van", "diversos", 100)]) }];
    const carros = planejarExtras({ pessoas: ps, unidade, tabelas: tab, veiculoMaximo: "van", sentido: "saida" });
    const ids = carros.flatMap((c) => c.pessoas.map((p) => p.id));
    expect(new Set(ids).size).toBe(400);
    expect(ids).toHaveLength(400);
    expect(carros.length).toBeLessThan(120);
    expect(carros.every((c) => c.paradas <= 10 && c.passageiros <= 15)).toBe(true);
  });
});
