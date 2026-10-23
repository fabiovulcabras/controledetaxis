"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { KpiCard } from "@/components/UI";
import { Campo, Filtros, PainelLateral, TopoPagina } from "@/components/Formulario";
import { SituacaoTag, SITUACOES, StatusTag } from "@/components/StatusTag";
import { brl, competencia, dataSP, formatarData, formatarDataHora } from "@/lib/datas";
import { gerarCsv, lerFaturaCsv, lerFaturaLinhas, type ItemFatura } from "@/lib/csv";
import { lerPlanilhaXlsx } from "@/lib/xlsx-leitura";
import type { StatusCorrida } from "@/lib/status";

type Fatura = { id: string; fornecedor_id: string; competencia: string; numero_nf: string | null; valor_total: number; status: string; criado_em: string; fornecedores?: { nome: string } | null };
type Item = {
  id: string; data_corrida: string | null; protocolo_informado: string | null; descricao: string | null; valor: number;
  corrida_id: string | null; situacao: string | null; decisao: "aceito" | "contestado" | null; observacao: string | null;
  corridas?: { id: string; protocolo: string; destino: string; status: StatusCorrida; valor_informado: number | null; solicitantes?: { nome: string } | null } | null;
};
type Visao = "todos" | "pendentes" | "problemas" | "conciliados";
const STATUS_FATURA: Record<string, string> = { importada: "Importada", em_conciliacao: "Em conciliação", conciliada: "Conciliada" };
const nomeCompetencia = (c: string) => { const [a, m] = c.split("-"); return `${m}/${a}`; };

export default function Conciliacao() {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string }[]>([]);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [err, setErr] = useState("");

  const carregar = async () => {
    const { data, error } = await supabase.from("faturas").select("*, fornecedores(nome)").order("criado_em", { ascending: false }).limit(100);
    if (error) setErr(error.message);
    setFaturas((data ?? []) as Fatura[]);
  };
  useEffect(() => {
    void carregar();
    supabase.from("fornecedores").select("id,nome").eq("ativo", true).order("nome").then(({ data }) => setFornecedores(data ?? []));
  }, []);

  const fatura = faturas.find((f) => f.id === selecionada) ?? null;

  return (
    <>
      <TopoPagina titulo="Conciliação" subtitulo="Importe a fatura do fornecedor e cruze cada cobrança com o protocolo da corrida.">
        <button type="button" className="pri" onClick={() => setImportando(true)}>+ Importar fatura</button>
      </TopoPagina>
      {err && <div className="err">{err}</div>}

      {faturas.length > 0 && (
        <div className="ordens-lista">
          {faturas.map((f) => (
            <button key={f.id} type="button" className={`ordem-cartao${f.id === selecionada ? " selecionada" : ""}`} onClick={() => setSelecionada(f.id)}>
              <div className="ordem-cartao-topo">
                <strong>{f.fornecedores?.nome ?? "—"}</strong>
                <span className={`tag ${f.status === "conciliada" ? "aprovada" : "pendente"}`}>{STATUS_FATURA[f.status] ?? f.status}</span>
              </div>
              <small>Competência {nomeCompetencia(f.competencia)}{f.numero_nf ? ` · NF ${f.numero_nf}` : ""}</small>
              <span className="protocolo" style={{ fontFamily: "inherit" }}>{brl(f.valor_total)}</span>
            </button>
          ))}
        </div>
      )}

      {!faturas.length && <section className="card"><p className="empty">Nenhuma fatura importada ainda. Use “Importar fatura” para começar.</p></section>}
      {fatura ? <DetalheFatura key={fatura.id} fatura={fatura} onMudou={carregar} /> : faturas.length > 0 && <p className="empty">Escolha uma fatura acima para conferir.</p>}

      {importando && <Importar fornecedores={fornecedores} onFechar={() => setImportando(false)} onImportou={async (id) => { setImportando(false); await carregar(); setSelecionada(id); }} />}
    </>
  );
}

function DetalheFatura({ fatura, onMudou }: { fatura: Fatura; onMudou: () => void }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [naoFaturadas, setNaoFaturadas] = useState<{ id: string; protocolo: string; data_hora_prevista: string; valor_informado: number | null; destino: string }[]>([]);
  const [visao, setVisao] = useState<Visao>("pendentes");
  const [contestando, setContestando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const carregar = async () => {
    const { data, error } = await supabase.from("fatura_itens")
      .select("*, corridas(id,protocolo,destino,status,valor_informado,solicitantes(nome))")
      .eq("fatura_id", fatura.id).order("data_corrida", { nullsFirst: false });
    if (error) setErr(error.message);
    const lista = (data ?? []) as Item[];
    setItens(lista);
    const [a, m] = fatura.competencia.split("-").map(Number);
    const inicio = dataSP(a, m, 1), fim = dataSP(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1, 1);
    const { data: corridas } = await supabase.from("corridas").select("id,protocolo,data_hora_prevista,valor_informado,destino")
      .eq("fornecedor_id", fatura.fornecedor_id).in("status", ["concluida", "validada", "contestada"])
      .gte("data_hora_prevista", inicio.toISOString()).lt("data_hora_prevista", fim.toISOString());
    const faturadas = new Set(lista.map((i) => i.corrida_id).filter(Boolean));
    setNaoFaturadas((corridas ?? []).filter((c: any) => !faturadas.has(c.id)) as any);
  };
  useEffect(() => { void carregar(); }, [fatura.id]);

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
  };
  const acao = async (trabalho: () => Promise<void>, sucesso: string) => {
    setOcupado(true); setErr(""); setOk("");
    try { await trabalho(); setOk(sucesso); await carregar(); onMudou(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setOcupado(false); }
  };

  const resumo = useMemo(() => {
    const por = (k: string) => itens.filter((i) => i.situacao === k).length;
    const problemas = itens.filter((i) => i.situacao && i.situacao !== "conciliado");
    return {
      total: itens.reduce((s, i) => s + Number(i.valor), 0),
      conciliados: por("conciliado"),
      divergentes: por("divergente") + por("sem_valor"),
      problemas: problemas.length - por("divergente") - por("sem_valor"),
      contestar: itens.filter((i) => i.decisao === "contestado" || (!i.decisao && i.situacao && i.situacao !== "conciliado")).reduce((s, i) => s + Number(i.valor), 0),
      pendentesConciliados: itens.filter((i) => i.situacao === "conciliado" && !i.decisao),
    };
  }, [itens]);

  const filtrados = itens.filter((i) => visao === "todos" ? true : visao === "pendentes" ? !i.decisao : visao === "conciliados" ? i.situacao === "conciliado" : i.situacao !== "conciliado");

  const exportar = () => {
    const linhas = itens.filter((i) => i.decisao === "contestado" || (!i.decisao && i.situacao !== "conciliado"));
    const csv = gerarCsv([["Data", "Protocolo", "Descrição", "Valor faturado", "Valor informado", "Situação", "Motivo"],
      ...linhas.map((i) => [i.data_corrida ? formatarData(`${i.data_corrida}T12:00:00Z`) : "", i.protocolo_informado, i.descricao, Number(i.valor), i.corridas?.valor_informado ?? null, SITUACOES[i.situacao ?? ""] ?? "", i.observacao])]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `contestacao-${fatura.fornecedores?.nome ?? "fornecedor"}-${fatura.competencia}.csv`.replace(/\s+/g, "-");
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="card ordem-detalhe">
      <div className="ordem-detalhe-topo">
        <div>
          <h3>{fatura.fornecedores?.nome} · competência {nomeCompetencia(fatura.competencia)}</h3>
          <p className="pagina-sub">{fatura.numero_nf ? `NF ${fatura.numero_nf} · ` : ""}importada em {formatarDataHora(fatura.criado_em)}</p>
        </div>
        <div className="row">
          <button type="button" className="ghost" disabled={ocupado} onClick={() => acao(() => rpc("fn_conciliar_fatura", { p_fatura: fatura.id }), "Conciliação refeita.")}>Refazer cruzamento</button>
          <button type="button" className="ghost" disabled={ocupado} onClick={exportar}>Exportar contestação</button>
          {resumo.pendentesConciliados.length > 0 && (
            <button type="button" className="pri" disabled={ocupado} onClick={() => acao(async () => {
              // Uma chamada só no banco; se a migração 003 ainda não rodou, cai para um item por vez
              const { error } = await supabase.rpc("fn_aceitar_conciliados", { p_fatura: fatura.id });
              if (error && /could not find|does not exist/i.test(error.message)) {
                for (const i of resumo.pendentesConciliados) await rpc("fn_decidir_item", { p_item: i.id, p_decisao: "aceito", p_obs: null });
              } else if (error) throw new Error(error.message);
            }, `${resumo.pendentesConciliados.length} item(ns) aceito(s); as corridas foram validadas.`)}>Aceitar {resumo.pendentesConciliados.length} conciliado(s)</button>
          )}
        </div>
      </div>
      {ok && <div className="ok">{ok}</div>}
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={brl(resumo.total)} label="Total faturado" />
        <KpiCard value={resumo.conciliados} label="Conciliados" />
        <KpiCard value={resumo.divergentes} label="Valor divergente ou sem valor" alert={resumo.divergentes > 0} />
        <KpiCard value={resumo.problemas} label="Sem protocolo, cancelada ou duplicada" alert={resumo.problemas > 0} />
        <KpiCard value={brl(resumo.contestar)} label="A contestar" />
      </div>

      <div className="repor-filtros">
        <Filtros<Visao> rotulo="Itens" valor={visao} onChange={setVisao} opcoes={[
          ["pendentes", "Sem decisão", itens.filter((i) => !i.decisao).length], ["problemas", "Com problema", itens.filter((i) => i.situacao !== "conciliado").length],
          ["conciliados", "Conciliados", resumo.conciliados], ["todos", "Todos", itens.length]]} />
        <span className="texto-fraco">Tolerância de valor nos parâmetros (padrão: 5% ou R$ 5,00, o maior).</span>
      </div>
      <div className="tw">
        <table>
          <thead><tr><th>Data</th><th>Protocolo na fatura</th><th>Corrida</th><th className="num">Faturado</th><th className="num">Informado</th><th>Situação</th><th>Decisão</th></tr></thead>
          <tbody>
            {filtrados.map((i) => {
              const dif = i.corridas?.valor_informado != null ? Number(i.valor) - Number(i.corridas.valor_informado) : null;
              return (
                <tr key={i.id}>
                  <td>{i.data_corrida ? formatarData(`${i.data_corrida}T12:00:00Z`).slice(0, 5) : "—"}</td>
                  <td><span className="protocolo">{i.protocolo_informado || "—"}</span>{i.descricao && <small className="bloco texto-fraco">{i.descricao}</small>}</td>
                  <td>{i.corridas ? <><Link href={`/corridas?id=${i.corridas.id}`} className="link-botao">{i.corridas.solicitantes?.nome ?? "—"}</Link><small className="bloco texto-fraco">{i.corridas.destino}</small><StatusTag status={i.corridas.status} /></> : <span className="texto-fraco">Não encontrada</span>}</td>
                  <td className="num">{brl(i.valor)}</td>
                  <td className="num">{brl(i.corridas?.valor_informado)}{dif != null && Math.abs(dif) >= 0.01 && <small className={`bloco ${dif > 0 ? "negative" : "positive"}`}>{dif > 0 ? "+" : ""}{brl(dif)}</small>}</td>
                  <td><SituacaoTag situacao={i.situacao} /></td>
                  <td style={{ minWidth: 200 }}>
                    {i.decisao ? (
                      <div className="row">
                        <span className={`tag ${i.decisao === "aceito" ? "aprovada" : "reprovada"}`}>{i.decisao === "aceito" ? "Aceito" : "Contestado"}</span>
                        {i.observacao && <small className="texto-fraco">{i.observacao}</small>}
                      </div>
                    ) : contestando === i.id ? (
                      <form className="row" onSubmit={(e) => { e.preventDefault(); void acao(() => rpc("fn_decidir_item", { p_item: i.id, p_decisao: "contestado", p_obs: motivo.trim() || null }), "Item contestado.").then(() => { setContestando(null); setMotivo(""); }); }}>
                        <input autoFocus placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required={i.situacao === "conciliado"} style={{ width: 140 }} />
                        <button className="danger" disabled={ocupado}>Contestar</button>
                        <button type="button" className="ghost" onClick={() => setContestando(null)}>✕</button>
                      </form>
                    ) : (
                      <div className="segmentos">
                        <button type="button" disabled={ocupado} onClick={() => acao(() => rpc("fn_decidir_item", { p_item: i.id, p_decisao: "aceito", p_obs: null }), "Item aceito.")}>Aceitar</button>
                        <button type="button" disabled={ocupado} onClick={() => { setContestando(i.id); setMotivo(i.situacao && i.situacao !== "conciliado" ? SITUACOES[i.situacao] : ""); }}>Contestar</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filtrados.length && <p className="empty">Nenhum item neste filtro.</p>}

      <h3 style={{ marginTop: 24 }}>Corridas concluídas que não vieram na fatura</h3>
      {naoFaturadas.length ? (
        <ul className="excecoes">
          {naoFaturadas.map((c) => (
            <li key={c.id}>
              <span className="sev aviso" />
              <div className="texto"><span className="protocolo">{c.protocolo}</span> · {formatarDataHora(c.data_hora_prevista)} · {c.destino}<small>{brl(c.valor_informado)} · cobrar na próxima fatura ou confirmar com o fornecedor</small></div>
              <Link className="ghost" href={`/corridas?id=${c.id}`}>Abrir</Link>
            </li>
          ))}
        </ul>
      ) : <p className="empty">Todas as corridas concluídas da competência foram faturadas.</p>}
    </section>
  );
}

function Importar({ fornecedores, onFechar, onImportou }: { fornecedores: { id: string; nome: string }[]; onFechar: () => void; onImportou: (id: string) => void }) {
  const [fornecedorId, setFornecedorId] = useState(fornecedores[0]?.id ?? "");
  const [comp, setComp] = useState(competencia(new Date()));
  const [nf, setNf] = useState("");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [planilha, setPlanilha] = useState<{ nome: string; itens: ItemFatura[]; erros: string[] } | null>(null);
  const lido = useMemo(() => planilha ?? (texto.trim() ? lerFaturaCsv(texto) : { itens: [] as ItemFatura[], erros: [] as string[] }), [texto, planilha]);
  const total = lido.itens.reduce((s, i) => s + i.valor, 0);

  const arquivo = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    if (/\.xls$/i.test(f.name)) { setErr("Arquivos .xls antigos não são lidos. Salve como .xlsx ou .csv e envie de novo."); return; }
    if (/\.xlsx$/i.test(f.name)) {
      try {
        const linhas = await lerPlanilhaXlsx(await f.arrayBuffer());
        setPlanilha({ nome: f.name, ...lerFaturaLinhas(linhas) });
        setTexto("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
      }
      return;
    }
    setPlanilha(null); setTexto(await f.text());
  };

  const importar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (!fornecedorId) { setErr("Escolha o fornecedor."); return; }
    if (!lido.itens.length) { setErr("Nenhum item reconhecido. Confira o arquivo."); return; }
    setOcupado(true);
    const { data: fat, error } = await supabase.from("faturas").insert({ fornecedor_id: fornecedorId, competencia: comp, numero_nf: nf.trim() || null }).select("id").single();
    if (error || !fat) { setOcupado(false); setErr(error?.message ?? "Não foi possível criar a fatura."); return; }
    const { error: e2 } = await supabase.from("fatura_itens").insert(lido.itens.map((i) => ({ ...i, fatura_id: fat.id })));
    if (e2) { await supabase.from("faturas").delete().eq("id", fat.id); setOcupado(false); setErr(e2.message); return; }
    const { error: e3 } = await supabase.rpc("fn_conciliar_fatura", { p_fatura: fat.id });
    setOcupado(false);
    if (e3) { setErr(`Fatura importada, mas o cruzamento falhou: ${e3.message}`); return; }
    onImportou(fat.id);
  };

  return (
    <PainelLateral titulo="Importar fatura" subtitulo="Excel (.xlsx) ou CSV com as colunas data, protocolo, descrição e valor" onFechar={onFechar} ocupado={ocupado} largura={620}>
      <form className="painel-corpo" onSubmit={importar} noValidate>
        <fieldset className="secao">
          <legend>Fatura</legend>
          <Campo rotulo="Fornecedor" obrigatorio largo>
            <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">Selecione</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Competência" obrigatorio><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} /></Campo>
          <Campo rotulo="Número da NF"><input value={nf} onChange={(e) => setNf(e.target.value)} maxLength={30} /></Campo>
        </fieldset>
        <fieldset className="secao">
          <legend>Itens</legend>
          <p className="secao-ajuda">Envie o arquivo .csv exportado da planilha do fornecedor ou cole as linhas abaixo. O protocolo é o número TX-AAAA-NNNNN que a corrida recebeu.</p>
          <label className="botao-arquivo campo-largo">Escolher arquivo (Excel ou CSV)<input type="file" accept=".csv,.xlsx,text/csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => arquivo(e.target.files?.[0])} /></label>
          <Campo rotulo="Conteúdo" largo ajuda="Exemplo: 19/10/2026;TX-2026-00012;Centro → GRU;142,50">
            <textarea rows={8} value={texto} onChange={(e) => { setPlanilha(null); setTexto(e.target.value); }} style={{ fontFamily: "Consolas, monospace", fontSize: 13 }} />
          </Campo>
          {planilha && <p className="resumo-entrada campo-largo">Planilha <strong>{planilha.nome}</strong></p>}
          {(texto.trim() || planilha) && <p className="resumo-entrada campo-largo"><strong>{lido.itens.length}</strong> item(ns) reconhecido(s), total <strong>{brl(total)}</strong>{lido.erros.length ? ` · ${lido.erros.length} linha(s) ignorada(s)` : ""}</p>}
          {lido.erros.slice(0, 5).map((m) => <p key={m} className="campo-aviso campo-largo" style={{ margin: 0 }}>{m}</p>)}
        </fieldset>
        {err && <div className="err">{err}</div>}
        <footer className="painel-rodape">
          <button type="button" className="ghost" onClick={onFechar} disabled={ocupado}>Cancelar</button>
          <button className="pri" disabled={ocupado || !lido.itens.length}>{ocupado ? "Importando…" : `Importar e cruzar ${lido.itens.length || ""} item(ns)`}</button>
        </footer>
      </form>
    </PainelLateral>
  );
}
