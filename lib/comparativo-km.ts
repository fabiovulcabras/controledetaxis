// Comparativo KM × tabela: quanto cada corrida custou (tabela/fatura) e quanto custaria pela tarifa por km.

export type FornecedorKm = { id: string; nome: string; valor_km: number | null; bandeirada: number | null };
export type CorridaKm = {
  id: string; protocolo: string; data_hora_prevista: string; origem: string; destino: string; fornecedor_id: string | null;
  distancia_km: number | null; distancia_fonte: string | null; preco_descricao: string | null;
  valor_tabela: number | null; preco_fornecedor_id: string | null; valor_informado: number | null; valor_faturado: number | null;
};

/** Valor pela tarifa por km do fornecedor (bandeirada + km × valor por km). Null sem tarifa ou sem distância. */
export function valorPorKm(km: number | null, f: Pick<FornecedorKm, "valor_km" | "bandeirada"> | null | undefined): number | null {
  if (km == null || !f || f.valor_km == null || !Number(f.valor_km)) return null;
  return Math.round((Number(f.bandeirada ?? 0) + Number(f.valor_km) * Number(km)) * 100) / 100;
}

/** Quanto a corrida custou: o faturado; sem fatura, a tabela do próprio fornecedor; sem tabela, o informado. */
export function valorPago(c: CorridaKm): { valor: number | null; base: "faturado" | "tabela" | "informado" | null } {
  if (c.valor_faturado != null) return { valor: Number(c.valor_faturado), base: "faturado" };
  if (c.valor_tabela != null && c.preco_fornecedor_id === c.fornecedor_id) return { valor: Number(c.valor_tabela), base: "tabela" };
  if (c.valor_informado != null) return { valor: Number(c.valor_informado), base: "informado" };
  return { valor: null, base: null };
}

export type LinhaComparativo = { chave: string; nome: string; corridas: number; km: number; pago: number; porKm: number; diferenca: number };
export type Comparativo = {
  linhas: (CorridaKm & { pago: number | null; base: string | null; porKm: number | null; porKmDe: Record<string, number | null> })[];
  porFornecedor: LinhaComparativo[];
  porTrecho: LinhaComparativo[];
  seTodasCom: { id: string; nome: string; corridas: number; porKm: number; pago: number }[];
  semKm: number; semTarifa: number; estimadas: number;
};

/**
 * Monta o comparativo. Só entram nos totais as corridas com distância, valor pago e tarifa por km do fornecedor que fez.
 * "seTodasCom": quanto as mesmas corridas custariam se todas fossem feitas por um fornecedor, pela tarifa dele.
 */
export function montarComparativo(corridas: CorridaKm[], fornecedores: FornecedorKm[]): Comparativo {
  const porId = new Map(fornecedores.map((f) => [f.id, f]));
  const comTarifa = fornecedores.filter((f) => f.valor_km != null && Number(f.valor_km) > 0);
  const linhas = corridas.map((c) => {
    const { valor, base } = valorPago(c);
    const km = c.distancia_km != null ? Number(c.distancia_km) : null;
    return { ...c, pago: valor, base, porKm: valorPorKm(km, c.fornecedor_id ? porId.get(c.fornecedor_id) : null),
      porKmDe: Object.fromEntries(comTarifa.map((f) => [f.id, valorPorKm(km, f)])) };
  });
  const validas = linhas.filter((l) => l.porKm != null && l.pago != null);
  const agrupar = (chave: (l: typeof linhas[number]) => [string, string]) => {
    const m = new Map<string, LinhaComparativo>();
    for (const l of validas) {
      const [k, nome] = chave(l);
      const g = m.get(k) ?? { chave: k, nome, corridas: 0, km: 0, pago: 0, porKm: 0, diferenca: 0 };
      g.corridas++; g.km += Number(l.distancia_km); g.pago += l.pago!; g.porKm += l.porKm!;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, km: Math.round(g.km * 10) / 10, pago: Math.round(g.pago * 100) / 100, porKm: Math.round(g.porKm * 100) / 100,
      diferenca: Math.round((g.porKm - g.pago) * 100) / 100 }));
  };
  const comPago = linhas.filter((l) => l.pago != null && l.distancia_km != null);
  return {
    linhas,
    porFornecedor: agrupar((l) => [l.fornecedor_id ?? "", porId.get(l.fornecedor_id ?? "")?.nome ?? "—"]).sort((a, b) => a.nome.localeCompare(b.nome)),
    porTrecho: agrupar((l) => { const t = l.preco_descricao || `${l.origem} → ${l.destino}`; return [t, t]; }).sort((a, b) => b.corridas - a.corridas),
    seTodasCom: comTarifa.map((f) => ({ id: f.id, nome: f.nome, corridas: comPago.length,
      porKm: Math.round(comPago.reduce((s, l) => s + (l.porKmDe[f.id] ?? 0), 0) * 100) / 100,
      pago: Math.round(comPago.reduce((s, l) => s + l.pago!, 0) * 100) / 100 })),
    semKm: linhas.filter((l) => l.distancia_km == null).length,
    semTarifa: linhas.filter((l) => l.distancia_km != null && l.porKm == null).length,
    estimadas: linhas.filter((l) => l.distancia_fonte === "estimada").length,
  };
}
