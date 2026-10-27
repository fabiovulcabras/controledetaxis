"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { KpiCard } from "@/components/UI";
import { Filtros, TopoPagina } from "@/components/Formulario";
import Barras from "@/components/Barras";
import { useRetorno } from "@/components/Retorno";
import { brl, dataSP, partesSP } from "@/lib/datas";
import { baixarXlsx } from "@/lib/xlsx";
import { minutosInteiros, taxaAceite } from "@/lib/relatorio";

type Fornecedor = {
  id: string; nome: string; recebidas: number; aceitas: number; recusadas: number; sem_resposta: number; minutos_resposta: number | null;
  qtd: number; valor: number; valor_tabela: number; com_tabela: number; acima_tabela: number; excesso: number;
};
type Grupo = { nome: string; qtd: number; valor: number; setor?: string | null; canceladas?: number; limite?: number | null };
type Resumo = {
  por_status: Record<string, number>; total: number; valor_total: number; valor_contestado: number;
  valor_tabela: number; valor_informado_com_tabela: number; acima_tabela: number; excesso_tabela: number;
  viagens: { recebidas: number; aceitas: number; decididas: number; minutos_resposta: number | null };
  por_dia: { dia: string; qtd: number; valor: number }[];
  por_solicitante: Grupo[]; por_fornecedor: Fornecedor[];
};
type Periodo = "mes" | "anterior" | "30dias" | "livre";
type Opcao = { id: string; nome: string };

const isoDia = (d: Date) => { const p = partesSP(d); return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`; };
const deIso = (s: string, fim = false) => { const [a, m, d] = s.split("-").map(Number); return fim ? dataSP(a, m, d, 23, 59) : dataSP(a, m, d); };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const txtTaxa = (aceitas: number, decididas: number) => { const t = taxaAceite(aceitas, decididas); return t == null ? "—" : `${t}%`; };
const txtMin = (v: number | null | undefined) => { const m = minutosInteiros(v); return m == null ? "—" : `${m} min`; };

function intervalo(p: Periodo, agora = new Date()): [string, string] {
  const h = partesSP(agora);
  if (p === "mes") return [isoDia(dataSP(h.ano, h.mes, 1)), isoDia(agora)];
  if (p === "anterior") {
    const ini = dataSP(h.mes === 1 ? h.ano - 1 : h.ano, h.mes === 1 ? 12 : h.mes - 1, 1);
    return [isoDia(ini), isoDia(new Date(dataSP(h.ano, h.mes, 1).getTime() - 86400_000))];
  }
  return [isoDia(new Date(agora.getTime() - 29 * 86400_000)), isoDia(agora)];
}

/** Gasto e desempenho no período, com filtro por fornecedor e pessoa autorizada. */
export default function Relatorios() {
  const { avisar } = useRetorno();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [[de, ate], setIntervalo] = useState<[string, string]>(() => intervalo("mes"));
  const [fornecedor, setFornecedor] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [opcoes, setOpcoes] = useState<{ fornecedores: Opcao[]; pessoas: Opcao[] }>({ fornecedores: [], pessoas: [] });
  const [r, setR] = useState<Resumo | null>(null);
  const [err, setErr] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const [f, s] = await Promise.all([
        supabase.from("fornecedores").select("id,nome").order("nome"),
        supabase.from("solicitantes").select("id,nome").order("nome"),
      ]);
      setOpcoes({
        fornecedores: (f.data ?? []) as Opcao[],
        pessoas: (s.data ?? []) as Opcao[],
      });
    })();
  }, []);
  useEffect(() => { if (periodo !== "livre") setIntervalo(intervalo(periodo)); }, [periodo]);
  useEffect(() => {
    (async () => {
      setCarregando(true);
      const { data, error } = await supabase.rpc("fn_relatorio", {
        p_de: deIso(de).toISOString(), p_ate: deIso(ate, true).toISOString(),
        p_fornecedor: fornecedor || null, p_solicitante: pessoa || null,
      });
      setErr(error ? `Não foi possível gerar o relatório: ${error.message}${/could not find|does not exist/i.test(error.message) ? " — rode a migração supabase/009_relatorios.sql." : ""}` : "");
      setR((data as Resumo) ?? null);
      setCarregando(false);
    })();
  }, [de, ate, fornecedor, pessoa]);

  const forn = r?.por_fornecedor ?? [];
  const v = r?.viagens;
  const filtrado = !!(fornecedor || pessoa);
  const nomeFiltro = [opcoes.fornecedores.find((x) => x.id === fornecedor)?.nome, opcoes.pessoas.find((x) => x.id === pessoa)?.nome].filter(Boolean).join(" · ");
  const sufixo = `${de}-a-${ate}`;

  const exportar = () => {
    if (!r) return;
    baixarXlsx(`fornecedores-${sufixo}.xlsx`, "Fornecedores", [
      { titulo: "Fornecedor", largura: 24 }, { titulo: "Viagens recebidas", formato: "inteiro", largura: 16 }, { titulo: "Aceitas", formato: "inteiro" },
      { titulo: "Recusadas", formato: "inteiro" }, { titulo: "Sem resposta", formato: "inteiro", largura: 12 }, { titulo: "Taxa de aceite (%)", formato: "inteiro", largura: 16 },
      { titulo: "Resposta média (min)", formato: "inteiro", largura: 18 }, { titulo: "Corridas concluídas", formato: "inteiro", largura: 18 },
      { titulo: "Valor informado", formato: "moeda", largura: 16 }, { titulo: "Valor de tabela", formato: "moeda", largura: 16 },
      { titulo: "Acima da tabela", formato: "inteiro", largura: 14 }, { titulo: "Excesso", formato: "moeda", largura: 14 },
    ], forn.map((f) => [f.nome, f.recebidas, f.aceitas, f.recusadas, f.sem_resposta, taxaAceite(f.aceitas, f.aceitas + f.recusadas + f.sem_resposta),
      minutosInteiros(f.minutos_resposta), f.qtd, Number(f.valor), f.com_tabela ? Number(f.valor_tabela) : null, f.acima_tabela, Number(f.excesso)]));
    baixarXlsx(`pessoas-${sufixo}.xlsx`, "Pessoas autorizadas", [
      { titulo: "Pessoa", largura: 24 }, { titulo: "Setor", largura: 16 }, { titulo: "Corridas", formato: "inteiro" }, { titulo: "Canceladas", formato: "inteiro" },
      { titulo: "Valor informado", formato: "moeda", largura: 16 }, { titulo: "Limite mensal", formato: "moeda", largura: 14 },
    ], r.por_solicitante.map((s) => [s.nome, s.setor ?? "", s.qtd, s.canceladas ?? 0, Number(s.valor), s.limite == null ? null : Number(s.limite)]));
    avisar("Duas planilhas baixadas: fornecedores e pessoas.");
  };

  return (
    <>
      <TopoPagina titulo="Relatórios" subtitulo={filtrado ? `Filtrado: ${nomeFiltro}` : "Gasto e desempenho dos fornecedores no período."}>
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
        <div className="filtros-corridas" style={{ marginBottom: 0 }}>
          <Selecao rotulo="Fornecedor" valor={fornecedor} set={setFornecedor} lista={opcoes.fornecedores} todos="Todos os fornecedores" />
          <Selecao rotulo="Pessoa autorizada" valor={pessoa} set={setPessoa} lista={opcoes.pessoas} todos="Todas as pessoas" />
          {filtrado && <button type="button" className="ghost" onClick={() => { setFornecedor(""); setPessoa(""); }}>Limpar filtros</button>}
        </div>
      </section>
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={r?.total ?? 0} label="Corridas no período" />
        <KpiCard value={brl(r?.valor_total ?? 0)} label="Valor informado" />
        <KpiCard value={txtTaxa(v?.aceitas ?? 0, v?.decididas ?? 0)} label={`Taxa de aceite${v?.decididas ? ` (${v.aceitas} de ${v.decididas} viagens)` : ""}`} />
        <KpiCard value={txtMin(v?.minutos_resposta)} label="Resposta média dos fornecedores" />
        <KpiCard value={r?.acima_tabela ?? 0} label={`Acima da tabela${r?.excesso_tabela ? ` (+${brl(r.excesso_tabela)})` : ""}`} alert={(r?.acima_tabela ?? 0) > 0} />
        <KpiCard value={brl(r?.valor_contestado ?? 0)} label="Contestado nas faturas" alert={(r?.valor_contestado ?? 0) > 0} />
      </div>

      <section className="card">
        <div className="repor-topo"><div><h3>Fornecedores</h3>
          <p className="repor-resumo">Cada viagem enviada ao fornecedor conta uma vez. Taxa de aceite = aceitas ÷ (aceitas + recusadas + sem resposta). Resposta média do envio ao aceite ou recusa, em minutos. Clique no nome para filtrar.</p>
        </div></div>
        <div className="tw">
          <table>
            <thead><tr>
              <th>Fornecedor</th><th className="num">Viagens</th><th className="num">Aceitas</th><th className="num">Recusadas</th><th className="num">Sem resposta</th>
              <th className="num">Aceite</th><th className="num">Resposta média</th><th className="num">Concluídas</th><th className="num">Valor informado</th>
              <th className="num">Valor de tabela</th><th className="num">Acima da tabela</th>
            </tr></thead>
            <tbody>
              {forn.map((f) => {
                const decididas = f.aceitas + f.recusadas + f.sem_resposta;
                return (
                  <tr key={f.id}>
                    <td className="repor-produto"><button type="button" className="atalho" onClick={() => setFornecedor(fornecedor === f.id ? "" : f.id)}>{f.nome}</button></td>
                    <td className="num">{f.recebidas}</td><td className="num">{f.aceitas}</td><td className="num">{f.recusadas}</td>
                    <td className={`num${f.sem_resposta ? " negative" : ""}`}>{f.sem_resposta}</td>
                    <td className="num"><strong>{txtTaxa(f.aceitas, decididas)}</strong>{decididas > 0 && <small className="bloco texto-fraco">{f.aceitas} de {decididas}</small>}</td>
                    <td className="num">{txtMin(f.minutos_resposta)}</td><td className="num">{f.qtd}</td><td className="num">{brl(f.valor)}</td>
                    <td className="num">{f.com_tabela ? brl(f.valor_tabela) : <span className="texto-fraco">—</span>}</td>
                    <td className={`num${f.acima_tabela ? " negative" : ""}`}>{f.acima_tabela ? <>{f.acima_tabela}<small className="bloco">+{brl(f.excesso)}</small></> : 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!forn.length && <p className="empty">{carregando ? "Carregando…" : "Nenhuma viagem enviada no período."}</p>}
        {(r?.acima_tabela ?? 0) > 0 && <p className="resumo-entrada" style={{ marginTop: 10 }}><Link href="/corridas">Ver as corridas</Link> — as que passaram da tabela aparecem com o valor de tabela em vermelho.</p>}
      </section>

      <section className="card">
        <div className="repor-topo"><div><h3>Corridas por dia</h3><p className="repor-resumo">{r?.total ?? 0} corrida(s) · {brl(r?.valor_total ?? 0)} informado</p></div></div>
        <GraficoDias dias={r?.por_dia ?? []} />
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
          <div className="repor-topo"><div><h3>Valor por fornecedor</h3></div></div>
          <Barras dados={forn.filter((f) => f.valor > 0).map((f) => ({ nome: f.nome, qtd: f.qtd, valor: Number(f.valor) }))} vazio={carregando ? "Carregando…" : "Nenhuma corrida concluída no período."} />
        </section>
      </div>
    </>
  );
}

/** Lista suspensa de filtro (fora do componente da página, para não perder o foco ao trocar). */
function Selecao({ rotulo, valor, set, lista, todos }: { rotulo: string; valor: string; set: (v: string) => void; lista: Opcao[]; todos: string }) {
  return (
    <label>{rotulo}
      <select value={valor} onChange={(e) => set(e.target.value)}>
        <option value="">{todos}</option>
        {lista.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
    </label>
  );
}

function GraficoDias({ dias }: { dias: { dia: string; qtd: number; valor: number }[] }) {
  if (!dias.length) return <p className="empty">Sem corridas no período.</p>;
  const max = Math.max(...dias.map((d) => d.qtd), 1);
  return (
    <div className="grafico-mensal" role="img" aria-label="Quantidade de corridas por dia">
      {dias.map((d) => (
        <div key={d.dia} className="grafico-mes" title={`${d.dia.slice(8)}/${d.dia.slice(5, 7)}: ${d.qtd} corrida(s), ${brl(d.valor)}`}>
          <div className="grafico-barras"><div className="grafico-barra saida" style={{ height: `${(d.qtd / max) * 100}%`, width: "60%" }} /></div>
          <small>{d.dia.slice(8)}</small>
        </div>
      ))}
    </div>
  );
}
