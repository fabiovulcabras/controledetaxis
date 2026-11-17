"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { KpiCard } from "@/components/UI";
import { brl, formatarDataHora } from "@/lib/datas";
import { baixarXlsx } from "@/lib/xlsx";
import { montarComparativo, type CorridaKm, type FornecedorKm } from "@/lib/comparativo-km";

const fmtKm = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
const dif = (n: number) => <span className={n > 0.005 ? "negative" : n < -0.005 ? "positive" : ""}>{n > 0 ? "+" : ""}{brl(n)}</span>;
const FONTE: Record<string, string> = { ors: "Rota (OpenRouteService)", osrm: "Rota (OSRM)", estimada: "Estimada (linha reta × 1,3)" };

/**
 * KM × tabela: para as corridas concluídas do período, compara o que foi pago (fatura, tabela ou informado)
 * com o que custaria pela tarifa por km do fornecedor (bandeirada + km × valor por km, em Cadastros › Fornecedores).
 */
export default function ComparativoKm({ de, ate, fornecedorId, podeCalcular }: { de: string; ate: string; fornecedorId: string; podeCalcular: boolean }) {
  const [corridas, setCorridas] = useState<CorridaKm[] | null>(null);
  const [fornecedores, setFornecedores] = useState<FornecedorKm[]>([]);
  const [err, setErr] = useState("");
  const [calc, setCalc] = useState<{ feitas: number; restantes: number; falhas: number } | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = async () => {
    let q = supabase.from("corridas")
      .select("id,protocolo,data_hora_prevista,origem,destino,fornecedor_id,distancia_km,distancia_fonte,preco_descricao,valor_tabela,preco_fornecedor_id,valor_informado,valor_faturado")
      .in("status", ["concluida", "validada", "contestada"]).gte("data_hora_prevista", de).lt("data_hora_prevista", ate).order("data_hora_prevista").limit(5000);
    if (fornecedorId) q = q.eq("fornecedor_id", fornecedorId);
    const [c, f] = await Promise.all([q, supabase.from("fornecedores").select("id,nome,valor_km,bandeirada").order("nome")]);
    if (c.error) { setErr(/distancia_fonte/.test(c.error.message) ? "Rode a migração supabase/016_km.sql no Supabase para ver o comparativo." : c.error.message); setCorridas([]); return; }
    setErr(""); setCorridas((c.data ?? []) as CorridaKm[]); setFornecedores((f.data ?? []) as FornecedorKm[]);
  };
  useEffect(() => { void carregar(); }, [de, ate, fornecedorId]);

  const comp = useMemo(() => montarComparativo(corridas ?? [], fornecedores), [corridas, fornecedores]);
  const total = comp.porFornecedor.reduce((s, l) => ({ pago: s.pago + l.pago, porKm: s.porKm + l.porKm, n: s.n + l.corridas, km: s.km + l.km }), { pago: 0, porKm: 0, n: 0, km: 0 });
  const semTarifaNomes = fornecedores.filter((f) => !f.valor_km && (corridas ?? []).some((c) => c.fornecedor_id === f.id)).map((f) => f.nome);

  const calcular = async () => {
    setRodando(true); setErr("");
    const pular: string[] = [];
    let feitas = 0;
    try {
      for (let rodada = 0; rodada < 60; rodada++) {
        const r = await chamarApi<{ calculadas: number; falharam: string[]; restantes: number }>("/api/corridas/km", { de, ate, fornecedorId: fornecedorId || null, pular });
        feitas += r.calculadas; pular.push(...r.falharam);
        setCalc({ feitas, restantes: r.restantes, falhas: pular.length });
        if (!r.restantes) break;
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível calcular."); }
    finally { setRodando(false); await carregar(); }
  };

  const exportar = () => {
    const comTarifa = fornecedores.filter((f) => f.valor_km);
    baixarXlsx(`km-x-tabela-${de.slice(0, 10)}.xlsx`, "KM x tabela", [
      { titulo: "Protocolo", largura: 16 }, { titulo: "Data", largura: 16 }, { titulo: "Fornecedor", largura: 18 }, { titulo: "Origem", largura: 32 }, { titulo: "Destino", largura: 32 },
      { titulo: "Trecho da tabela", largura: 26 }, { titulo: "Km", formato: "decimal", largura: 8 }, { titulo: "Origem do km", largura: 22 },
      { titulo: "Valor pago", formato: "moeda", largura: 12 }, { titulo: "Base do valor", largura: 12 }, { titulo: "Por km (mesmo fornecedor)", formato: "moeda", largura: 18 },
      { titulo: "Diferença", formato: "moeda", largura: 12 }, ...comTarifa.map((f) => ({ titulo: `Por km – ${f.nome}`, formato: "moeda" as const, largura: 16 })),
    ], comp.linhas.map((l) => [l.protocolo, formatarDataHora(l.data_hora_prevista), fornecedores.find((f) => f.id === l.fornecedor_id)?.nome ?? "", l.origem, l.destino,
      l.preco_descricao, l.distancia_km != null ? Number(l.distancia_km) : null, l.distancia_fonte ? FONTE[l.distancia_fonte] : "", l.pago, l.base ?? "", l.porKm,
      l.porKm != null && l.pago != null ? Math.round((l.porKm - l.pago) * 100) / 100 : null, ...comTarifa.map((f) => l.porKmDe[f.id])]));
  };

  return (
    <section className="card">
      <div className="repor-topo">
        <div>
          <h3>KM × tabela</h3>
          <p className="repor-resumo">Corridas concluídas do período: o que foi pago (fatura; sem fatura, a tabela; sem tabela, o informado) contra a tarifa por km do fornecedor (bandeirada + km × valor por km, em Cadastros › Fornecedores). O km é o trajeto origem → destino por ruas, sem a volta do carro vazio. Diferença positiva: por km sairia mais caro.</p>
        </div>
        <div className="row">
          {podeCalcular && (comp.semKm > 0 || comp.estimadas > 0) && <button type="button" className="ghost" disabled={rodando} onClick={calcular}>{rodando ? "Calculando…" : `Calcular km (${comp.semKm + comp.estimadas})`}</button>}
          <button type="button" className="ghost" onClick={exportar} disabled={!corridas?.length}>Exportar Excel</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {calc && <p className="resumo-entrada">{rodando ? "Calculando… " : ""}{calc.feitas} corrida(s) com km calculado{calc.restantes ? `, faltam ${calc.restantes}` : ""}{calc.falhas ? ` · ${calc.falhas} sem rota (endereço não encontrado no mapa ou serviço indisponível; ficam de fora ou com estimativa)` : ""}.</p>}
      {semTarifaNomes.length > 0 && <p className="resumo-entrada">Sem valor por km cadastrado: <strong>{semTarifaNomes.join(", ")}</strong>. <Link href="/cadastros#fornecedores">Cadastrar em Fornecedores</Link>.</p>}

      {corridas === null ? <p className="empty">Carregando…</p> : !comp.porFornecedor.length ? (
        <p className="empty">{!corridas.length ? "Nenhuma corrida concluída no período." : comp.semKm ? `${comp.semKm} corrida(s) ainda sem km. Use “Calcular km”.` : "Cadastre o valor por km dos fornecedores para comparar."}</p>
      ) : (
        <>
          <div className="kpis">
            <KpiCard value={brl(total.pago)} label={`Pago (${total.n} corrida(s), ${fmtKm(total.km)})`} />
            <KpiCard value={brl(total.porKm)} label="Se fosse por km" />
            <KpiCard value={`${total.porKm - total.pago > 0 ? "+" : ""}${brl(Math.round((total.porKm - total.pago) * 100) / 100)}`} alert={total.porKm - total.pago > 0.005}
              label={`${total.pago ? `${(((total.porKm - total.pago) / total.pago) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ` : ""}por km em relação ao pago`} />
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Fornecedor</th><th className="num">Corridas</th><th className="num">Km</th><th className="num">Pago</th><th className="num">Por km</th><th className="num">Diferença</th></tr></thead>
              <tbody>{comp.porFornecedor.map((l) => <tr key={l.chave}><td>{l.nome}</td><td className="num">{l.corridas}</td><td className="num">{fmtKm(l.km)}</td><td className="num">{brl(l.pago)}</td><td className="num">{brl(l.porKm)}</td><td className="num">{dif(l.diferenca)}</td></tr>)}</tbody>
            </table>
          </div>
          {comp.seTodasCom.length > 1 && (
            <>
              <h4 style={{ margin: "16px 0 6px" }}>Se todas as corridas com km fossem de um só fornecedor, por km</h4>
              <div className="tw"><table className="tabela-compacta">
                <thead><tr><th>Fornecedor</th><th className="num">Corridas</th><th className="num">Por km</th><th className="num">Pago hoje</th><th className="num">Diferença</th></tr></thead>
                <tbody>{comp.seTodasCom.map((s) => <tr key={s.id}><td>{s.nome}</td><td className="num">{s.corridas}</td><td className="num">{brl(s.porKm)}</td><td className="num">{brl(s.pago)}</td><td className="num">{dif(Math.round((s.porKm - s.pago) * 100) / 100)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
          <h4 style={{ margin: "16px 0 6px" }}>Por trecho</h4>
          <div className="tw"><table className="tabela-compacta">
            <thead><tr><th>Trecho</th><th className="num">Corridas</th><th className="num">Km médio</th><th className="num">Pago médio</th><th className="num">Por km médio</th><th className="num">Diferença</th></tr></thead>
            <tbody>{comp.porTrecho.slice(0, 30).map((l) => <tr key={l.chave}><td>{l.nome}</td><td className="num">{l.corridas}</td><td className="num">{fmtKm(l.km / l.corridas)}</td><td className="num">{brl(l.pago / l.corridas)}</td><td className="num">{brl(l.porKm / l.corridas)}</td><td className="num">{dif(l.diferenca)}</td></tr>)}</tbody>
          </table></div>
          {(comp.semKm > 0 || comp.semTarifa > 0 || comp.estimadas > 0) && <p className="texto-fraco" style={{ fontSize: 13, marginTop: 8 }}>
            Fora dos totais: {comp.semKm} sem km, {comp.semTarifa} de fornecedor sem valor por km. {comp.estimadas ? `${comp.estimadas} com km estimado (linha reta × 1,3).` : ""}
          </p>}
        </>
      )}
    </section>
  );
}
