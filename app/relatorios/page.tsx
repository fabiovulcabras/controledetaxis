"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { KpiCard } from "@/components/UI";
import { Filtros, TopoPagina } from "@/components/Formulario";
import Barras from "@/components/Barras";
import { useRetorno } from "@/components/Retorno";
import { brl, dataSP, partesSP } from "@/lib/datas";
import { baixarXlsx } from "@/lib/xlsx";

type Fornecedor = { nome: string; enviadas: number; aceitas: number; recusadas: number; sem_resposta: number; minutos_resposta: number | null; qtd: number; valor: number };
type Grupo = { nome: string; qtd: number; valor: number; setor?: string | null; canceladas?: number; limite?: number | null };
type Resumo = {
  por_status: Record<string, number>; total: number; valor_total: number; valor_contestado: number;
  por_centro: Grupo[]; por_solicitante: Grupo[]; por_fornecedor: Fornecedor[];
};
type Periodo = "mes" | "anterior" | "30dias" | "livre";

const isoDia = (d: Date) => { const p = partesSP(d); return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`; };
const deIso = (s: string, fim = false) => { const [a, m, d] = s.split("-").map(Number); return fim ? dataSP(a, m, d, 23, 59) : dataSP(a, m, d); };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function intervalo(p: Periodo, agora = new Date()): [string, string] {
  const h = partesSP(agora);
  if (p === "mes") return [isoDia(dataSP(h.ano, h.mes, 1)), isoDia(agora)];
  if (p === "anterior") {
    const ini = dataSP(h.mes === 1 ? h.ano - 1 : h.ano, h.mes === 1 ? 12 : h.mes - 1, 1);
    return [isoDia(ini), isoDia(new Date(dataSP(h.ano, h.mes, 1).getTime() - 86400_000))];
  }
  return [isoDia(new Date(agora.getTime() - 29 * 86400_000)), isoDia(agora)];
}

/** Gasto e desempenho no período: por centro de custo, por pessoa autorizada e por fornecedor. */
export default function Relatorios() {
  const { avisar } = useRetorno();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [[de, ate], setIntervalo] = useState<[string, string]>(() => intervalo("mes"));
  const [r, setR] = useState<Resumo | null>(null);
  const [err, setErr] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => { if (periodo !== "livre") setIntervalo(intervalo(periodo)); }, [periodo]);
  useEffect(() => {
    (async () => {
      setCarregando(true);
      const { data, error } = await supabase.rpc("fn_resumo_periodo", { p_de: deIso(de).toISOString(), p_ate: deIso(ate, true).toISOString() });
      setErr(error ? `Não foi possível gerar o relatório: ${error.message}${/could not find|does not exist/i.test(error.message) ? " — rode a migração supabase/003_melhorias.sql." : ""}` : "");
      setR((data as Resumo) ?? null);
      setCarregando(false);
    })();
  }, [de, ate]);

  const forn = r?.por_fornecedor ?? [];
  const enviadas = forn.reduce((n, f) => n + f.enviadas, 0), aceitas = forn.reduce((n, f) => n + f.aceitas, 0);
  const canceladas = r?.por_status?.cancelada ?? 0;
  const sufixo = `${de}-a-${ate}`;

  const exportar = () => {
    if (!r) return;
    baixarXlsx(`fornecedores-${sufixo}.xlsx`, "Fornecedores", [
      { titulo: "Fornecedor", largura: 24 }, { titulo: "Recebidas", formato: "inteiro" }, { titulo: "Aceitas", formato: "inteiro" }, { titulo: "Recusadas", formato: "inteiro" },
      { titulo: "Sem resposta", formato: "inteiro" }, { titulo: "Taxa de aceite", largura: 12 }, { titulo: "Resposta média (min)", formato: "decimal", largura: 18 },
      { titulo: "Corridas concluídas", formato: "inteiro", largura: 18 }, { titulo: "Valor informado", formato: "moeda", largura: 16 },
    ], forn.map((f) => [f.nome, f.enviadas, f.aceitas, f.recusadas, f.sem_resposta, pct(f.aceitas, f.enviadas), f.minutos_resposta, f.qtd, Number(f.valor)]));
    baixarXlsx(`centros-de-custo-${sufixo}.xlsx`, "Centros de custo", [
      { titulo: "Centro de custo", largura: 30 }, { titulo: "Corridas", formato: "inteiro" }, { titulo: "Valor informado", formato: "moeda", largura: 16 },
    ], r.por_centro.map((c) => [c.nome, c.qtd, Number(c.valor)]));
    baixarXlsx(`pessoas-${sufixo}.xlsx`, "Pessoas autorizadas", [
      { titulo: "Pessoa", largura: 24 }, { titulo: "Setor", largura: 16 }, { titulo: "Corridas", formato: "inteiro" }, { titulo: "Canceladas", formato: "inteiro" },
      { titulo: "Valor informado", formato: "moeda", largura: 16 }, { titulo: "Limite mensal", formato: "moeda", largura: 14 },
    ], r.por_solicitante.map((s) => [s.nome, s.setor ?? "", s.qtd, s.canceladas ?? 0, Number(s.valor), s.limite == null ? null : Number(s.limite)]));
    avisar("Três planilhas baixadas: fornecedores, centros de custo e pessoas.");
  };

  return (
    <>
      <TopoPagina titulo="Relatórios" subtitulo="Gasto e desempenho no período, pelo valor que os fornecedores informaram.">
        <button type="button" className="ghost" onClick={exportar} disabled={!r || carregando}>Exportar Excel</button>
      </TopoPagina>
      <section className="card">
        <div className="filtros-corridas">
          <Filtros<Periodo> rotulo="Período" valor={periodo} onChange={setPeriodo} opcoes={[["mes", "Este mês"], ["anterior", "Mês passado"], ["30dias", "Últimos 30 dias"], ["livre", "Escolher datas"]]} />
          {periodo === "livre" && <>
            <label>De<input type="date" value={de} onChange={(e) => e.target.value && setIntervalo([e.target.value, ate])} /></label>
            <label>Até<input type="date" value={ate} onChange={(e) => e.target.value && setIntervalo([de, e.target.value])} /></label>
          </>}
        </div>
      </section>
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={r?.total ?? 0} label="Corridas no período" />
        <KpiCard value={brl(r?.valor_total ?? 0)} label="Valor informado" />
        <KpiCard value={pct(aceitas, enviadas)} label="Taxa de aceite dos fornecedores" />
        <KpiCard value={canceladas} label="Canceladas" />
        <KpiCard value={brl(r?.valor_contestado ?? 0)} label="Contestado nas faturas" alert={(r?.valor_contestado ?? 0) > 0} />
      </div>

      <section className="card">
        <div className="repor-topo"><div><h3>Fornecedores</h3><p className="repor-resumo">Aceite e tempo de resposta contam cada vez que a corrida foi enviada ao fornecedor.</p></div></div>
        <div className="tw">
          <table>
            <thead><tr><th>Fornecedor</th><th className="num">Recebidas</th><th className="num">Aceitas</th><th className="num">Recusadas</th><th className="num">Sem resposta</th><th className="num">Aceite</th><th className="num">Resposta média</th><th className="num">Concluídas</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {forn.map((f) => (
                <tr key={f.nome}>
                  <td className="repor-produto">{f.nome}</td><td className="num">{f.enviadas}</td><td className="num">{f.aceitas}</td><td className="num">{f.recusadas}</td>
                  <td className={`num${f.sem_resposta ? " negative" : ""}`}>{f.sem_resposta}</td><td className="num">{pct(f.aceitas, f.enviadas)}</td>
                  <td className="num">{f.minutos_resposta != null ? `${String(f.minutos_resposta).replace(".", ",")} min` : "—"}</td><td className="num">{f.qtd}</td><td className="num">{brl(f.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!forn.length && <p className="empty">{carregando ? "Carregando…" : "Nenhuma corrida enviada no período."}</p>}
      </section>

      <div className="grade-2">
        <section className="card">
          <div className="repor-topo"><div><h3>Pessoas autorizadas</h3><p className="repor-resumo">Quem mais pediu táxi no período e quanto do limite mensal já usou.</p></div></div>
          <div className="tw">
            <table className="tabela-compacta">
              <thead><tr><th>Pessoa</th><th className="num">Corridas</th><th className="num">Canceladas</th><th className="num">Valor</th><th className="num">Do limite</th></tr></thead>
              <tbody>
                {(r?.por_solicitante ?? []).map((s) => (
                  <tr key={s.nome}>
                    <td>{s.nome}<small className="bloco texto-fraco">{s.setor ?? ""}</small></td><td className="num">{s.qtd}</td><td className="num">{s.canceladas ?? 0}</td><td className="num">{brl(s.valor)}</td>
                    <td className={`num${s.limite && s.valor > s.limite ? " negative" : ""}`}>{s.limite ? pct(Number(s.valor), Number(s.limite)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!r?.por_solicitante?.length && <p className="empty">{carregando ? "Carregando…" : "Sem corridas no período."}</p>}
        </section>
        <section className="card">
          <div className="repor-topo"><div><h3>Centros de custo</h3></div></div>
          <Barras dados={(r?.por_centro ?? []).filter((c) => c.valor > 0)} vazio={carregando ? "Carregando…" : "Nenhuma corrida concluída no período."} />
        </section>
      </div>
    </>
  );
}
