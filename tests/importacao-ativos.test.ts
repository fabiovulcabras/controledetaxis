import { describe, expect, it } from "vitest";
import { compararAtivos, lerAtivos, lerDataCelula, normalizarCodigo, planilhaSuspeita, type Colaborador } from "../lib/importacao-ativos";

const CAB = ["Código", "Nome", "Estabelecim", "Cod Cargo", "Cargo", "Lotacao", "Nome Lotacao", "Jornada", "Horario", "Admissao", "Venc Exp1", "Venc Exp2", "Endereco", "Cidade", "Bairro", "CEP", "Situacao"];
const linha = (codigo: string, nome: string, cargo = "AUXILIAR LOGISTICA", setor = "LOGISTICA - DTC", admissao = "45376") => {
  const l = CAB.map(() => "");
  l[0] = codigo; l[1] = nome; l[4] = cargo; l[6] = setor; l[9] = admissao; l[16] = "1";
  return l;
};
const colab = (codigo: string, nome: string, ativo = true): Colaborador => ({ id: `id-${codigo}`, codigo, nome, cargo: "AUXILIAR LOGISTICA", setor: "LOGISTICA - DTC", admissao: "2024-03-25", situacao: "1", ativo });

describe("importação de ativos", () => {
  it("lê o modelo do RH", () => {
    const r = lerAtivos([CAB, linha("15000923", "ADERBAL"), linha("15001057.0", "ADILSON")]);
    expect(r.erros).toEqual([]);
    expect(r.registros.map((a) => a.codigo)).toEqual(["15000923", "15001057"]);
    expect(r.registros[0]).toMatchObject({ nome: "ADERBAL", cargo: "AUXILIAR LOGISTICA", setor: "LOGISTICA - DTC", admissao: "2024-03-25", situacao: "1" });
  });

  it("recusa planilha sem Código ou Nome e avisa sobre repetidos", () => {
    expect(lerAtivos([["Nome"], ["A"]]).erros[0]).toMatch(/Código/);
    expect(lerAtivos([]).erros[0]).toMatch(/vazia/);
    const r = lerAtivos([CAB, linha("1", "A"), linha("1", "B"), linha("", "SEM CODIGO")]);
    expect(r.registros).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/repetido/);
    expect(r.erros[0]).toMatch(/falta o código/);
  });

  it("normaliza código e data", () => {
    expect(normalizarCodigo(" 015000923.0 ")).toBe("15000923");
    expect(normalizarCodigo("AB-12")).toBe("AB-12");
    expect(lerDataCelula("45376")).toBe("2024-03-25");
    expect(lerDataCelula("25/03/2024")).toBe("2024-03-25");
    expect(lerDataCelula("texto")).toBeNull();
  });

  it("separa novos, ausentes, reativações e atualizações pelo código", () => {
    const arquivo = lerAtivos([CAB, linha("1", "ANA"), linha("2", "BIA NOVA", "LIDER LOGISTICA"), linha("3", "CARLA"), linha("4", "DUDA")]).registros;
    const cadastro = [colab("1", "ANA"), colab("2", "BIA"), colab("3", "CARLA", false), colab("9", "SAIU"), colab("8", "JA SAIU", false)];
    const r = compararAtivos(arquivo, cadastro);
    expect(r.novos.map((a) => a.codigo)).toEqual(["4"]);
    expect(r.reativar.map((a) => a.id)).toEqual(["id-3"]);
    expect(r.atualizar.map((a) => a.codigo)).toEqual(["2"]);
    expect(r.ausentes.map((c) => c.codigo)).toEqual(["9"]);
    expect(r.iguais).toBe(1);
  });

  it("desconfia de planilha que deixa de fora muita gente", () => {
    expect(planilhaSuspeita(40, 100)).toBe(true);
    expect(planilhaSuspeita(5, 10)).toBe(false);
    expect(planilhaSuspeita(10, 300)).toBe(false);
  });
});
