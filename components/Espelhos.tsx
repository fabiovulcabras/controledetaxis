"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { KpiCard } from "@/components/UI";
import { Campo, PainelLateral, TopoPagina } from "@/components/Formulario";
import { brl, formatarData, formatarDataHora, lerValor } from "@/lib/datas";
import { baixarXlsx } from "@/lib/xlsx";
import { TIPOS_EXTRA } from "@/lib/extras";
import { ORIGEM_BASE, STATUS_ESPELHO, competenciaAnterior, glosaItem, nomeCompetencia, type StatusEspelho } from "@/lib/espelho-status";
import { abrirArquivo } from "@/components/ExtrasCorrida";

type Espelho = {
  id: string; fornecedor_id: string; competencia: string; status: StatusEspelho; versao: number; total: number; enviado_em: string | null;
  prazo_em: string | null; lembrete_enviado_em: string | null; aprovado_em: string | null; aprovacao: "fornecedor" | "tacita" | null;
  nf_numero: string | null; nf_valor: number | null; nf_arquivo: string | null; nf_enviada_em: string | null; pago_em: string | null;
  criado_em: string; fornecedores?: { nome: string } | null;
};
type Item = {
  id: string; corrida_id: string; valor_informado: number | null; valor_tabela: number | null; valor_base: number; base_origem: string; conferir: boolean;
  ajuste_obs: string | null; valor_extras: number; valor_final: number; contestacao_status: "contestado" | "aceita" | "mantida" | null;
  contestacao_motivo: string | null; contestacao_valor: number | null; contestacao_resposta: string | null;
  corridas?: { id: string; protocolo: string; data_hora_prevista: string; destino: string; solicitantes?: { nome: string } | null } | null;
};
type ExtraEsp = { corrida_id: string; tipo: keyof typeof TIPOS_EXTRA; valor: number; status: string };
type Evento = { id: string; origem: string; tipo: string; descricao: string | null; criado_em: string; profiles?: { nome: string } | null };

const ORIGEM_EVENTO: Record<string, string> = { planejamento: "Planejamento", fornecedor: "Fornecedor", sistema: "Automático" };

export default function Espelhos({ podeAgir }: { podeAgir: boolean }) {
  const [lista, setLista] = useState<Espelho[] | null>(null);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string }[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [err, setErr] = useState("");

  const carregar = async () => {
    const { data, error } = await supabase.from("espelhos").select("*, fornecedores(nome)").order("competencia", { ascending: false }).order("criado_em", { ascending: false }).limit(100);
    if (error) { setErr(/espelhos/.test(error.message) ? "O banco ainda não tem o espelho. Rode supabase/015_espelho.sql no Supabase e recarregue." : error.message); setLista([]); return; }
    setLista((data ?? []) as Espelho[]);
  };
  useEffect(() => {
    void carregar();
    supabase.from("fornecedores").select("id,nome").eq("ativo", true).order("nome").then(({ data }) => setFornecedores(data ?? []));
    const id = new URLSearchParams(window.location.search).get("espelho");
    if (id) setSelecionado(id);
  }, []);

  const espelho = lista?.find((e) => e.id === selecionado) ?? null;
  return (
    <>
      <TopoPagina titulo="Espelhos do mês" subtitulo="O fechamento de cada fornecedor: corridas concluídas pelo valor de tabela (sem tabela, o informado) mais os extras aprovados. O fornecedor confere no portal e aprova ou contesta; sem resposta em 5 dias úteis, o espelho é aprovado automaticamente.">
        {podeAgir && <button type="button" className="pri" onClick={() => setGerando(true)}>+ Gerar espelho</button>}
      </TopoPagina>
      {err && <div className="err">{err}</div>}
      {lista && lista.length > 0 && (
        <div className="ordens-lista">
          {lista.map((e) => (
            <button key={e.id} type="button" className={`ordem-cartao${e.id === selecionado ? " selecionada" : ""}`} onClick={() => setSelecionado(e.id)}>
              <div className="ordem-cartao-topo"><strong>{e.fornecedores?.nome ?? "—"}</strong><span className={`tag ${STATUS_ESPELHO[e.status].tag}`}>{STATUS_ESPELHO[e.status].rotulo}</span></div>
              <small>Competência {nomeCompetencia(e.competencia)}{e.versao > 1 ? ` · versão ${e.versao}` : ""}{e.status === "aguardando" && e.prazo_em ? ` · prazo ${formatarDataHora(e.prazo_em)}` : ""}</small>
              <span className="protocolo" style={{ fontFamily: "inherit" }}>{brl(e.total)}</span>
            </button>
          ))}
        </div>
      )}
      {lista && !lista.length && !err && <section className="card"><p className="empty">Nenhum espelho gerado ainda. Decida os extras pendentes e use “Gerar espelho” no fechamento do mês.</p></section>}
      {espelho ? <DetalheEspelho key={espelho.id + espelho.versao + espelho.status} espelho={espelho} podeAgir={podeAgir} onMudou={carregar} />
        : lista && lista.length > 0 && <p className="empty">Escolha um espelho acima para ver os itens.</p>}
      {gerando && <GerarEspelho fornecedores={fornecedores} onFechar={() => setGerando(false)} onGerou={async (id) => { setGerando(false); await carregar(); setSelecionado(id); }} />}
    </>
  );
}

function GerarEspelho({ fornecedores, onFechar, onGerou }: { fornecedores: { id: string; nome: string }[]; onFechar: () => void; onGerou: (id: string) => void }) {
  const [fornecedorId, setFornecedorId] = useState("");
  const [comp, setComp] = useState(competenciaAnterior());
  const [previa, setPrevia] = useState<{ corridas: number; pendentes: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setPrevia(null);
    if (!fornecedorId || !/^\d{4}-\d{2}$/.test(comp)) return;
    const [a, m] = comp.split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 1, 1, 3)).toISOString(), fim = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1, 3)).toISOString();
    void (async () => {
      const { data: cs } = await supabase.from("corridas").select("id").eq("fornecedor_id", fornecedorId).in("status", ["concluida", "validada", "contestada"]).gte("data_hora_prevista", ini).lt("data_hora_prevista", fim);
      const ids = (cs ?? []).map((c) => c.id);
      const { count } = ids.length ? await supabase.from("corrida_extras").select("id", { count: "exact", head: true }).in("corrida_id", ids).eq("status", "pendente") : { count: 0 };
      setPrevia({ corridas: ids.length, pendentes: count ?? 0 });
    })();
  }, [fornecedorId, comp]);

  const gerar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setOcupado(true);
    try {
      const r = await chamarApi<{ espelhoId: string }>("/api/espelhos", { acao: "gerar", fornecedorId, competencia: comp });
      onGerou(r.espelhoId);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Não foi possível gerar."); }
    finally { setOcupado(false); }
  };
  return (
    <PainelLateral titulo="Gerar espelho" subtitulo="O fornecedor recebe o aviso e confere pelo portal" onFechar={onFechar} ocupado={ocupado} largura={520}>
      <form className="painel-corpo" onSubmit={gerar} noValidate>
        <fieldset className="secao">
          <legend>Fechamento</legend>
          <Campo rotulo="Fornecedor" obrigatorio largo>
            <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">Selecione</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Competência" obrigatorio><input type="month" value={comp} onChange={(e) => setComp(e.target.value)} /></Campo>
          {previa && <p className="resumo-entrada campo-largo"><strong>{previa.corridas}</strong> corrida(s) concluída(s) em {nomeCompetencia(comp)}{previa.pendentes ? <> · <span className="err" style={{ display: "inline", padding: 0, background: "none" }}>{previa.pendentes} extra(s) aguardando decisão — decida antes de gerar</span></> : null}</p>}
          <p className="secao-ajuda campo-largo">Entram as corridas concluídas do mês pelo valor de tabela; sem preço na tabela, pelo valor informado (marcadas para conferir). Extras: só os aprovados. Corridas canceladas não entram. Depois de gerado, o fornecedor não lança mais extras nessas corridas e tem até o fim do 5º dia útil para responder.</p>
        </fieldset>
        {err && <div className="err">{err}</div>}
        <footer className="painel-rodape">
          <button type="button" className="ghost" onClick={onFechar} disabled={ocupado}>Cancelar</button>
          <button className="pri" disabled={ocupado || !fornecedorId || !previa?.corridas || !!previa?.pendentes}>{ocupado ? "Gerando…" : "Gerar e enviar ao fornecedor"}</button>
        </footer>
      </form>
    </PainelLateral>
  );
}

function DetalheEspelho({ espelho: e, podeAgir, onMudou }: { espelho: Espelho; podeAgir: boolean; onMudou: () => Promise<void> }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [extras, setExtras] = useState<ExtraEsp[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [filtro, setFiltro] = useState<"todos" | "conferir" | "contestados">("todos");
  const [editando, setEditando] = useState<{ id: string; tipo: "ajuste" | "mantida"; valor: string; obs: string } | null>(null);
  const [pagoEm, setPagoEm] = useState(() => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10));
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const carregar = async () => {
    const [i, x, ev] = await Promise.all([
      supabase.from("espelho_itens").select("*, corridas(id,protocolo,data_hora_prevista,destino,solicitantes(nome))").eq("espelho_id", e.id),
      supabase.from("corrida_extras").select("corrida_id,tipo,valor,status").eq("espelho_id", e.id),
      supabase.from("espelho_eventos").select("*, profiles(nome)").eq("espelho_id", e.id).order("criado_em", { ascending: false }),
    ]);
    if (i.error) setErr(i.error.message);
    setItens(((i.data ?? []) as Item[]).sort((a, b) => String(a.corridas?.data_hora_prevista).localeCompare(String(b.corridas?.data_hora_prevista))));
    setExtras((x.data ?? []) as ExtraEsp[]);
    setEventos((ev.data ?? []) as Evento[]);
  };
  useEffect(() => { void carregar(); }, [e.id]);

  const acao = async (trabalho: () => Promise<unknown>, sucesso: string) => {
    setOcupado(true); setErr(""); setOk("");
    try { await trabalho(); setOk(sucesso); setEditando(null); await carregar(); await onMudou(); }
    catch (x) { setErr(x instanceof Error ? x.message : "Não foi possível concluir."); }
    finally { setOcupado(false); }
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message); };

  const extrasPedidos = (corridaId: string) => extras.filter((x) => x.corrida_id === corridaId).reduce((s, x) => s + Number(x.valor), 0);
  const resumo = useMemo(() => {
    const glosas = itens.map((i) => ({ i, g: glosaItem({ valor_informado: i.valor_informado != null ? Number(i.valor_informado) : null, valor_base: Number(i.valor_base), valor_final: Number(i.valor_final) }, extrasPedidos(i.corrida_id)) }));
    return {
      conferir: itens.filter((i) => i.conferir).length,
      contestados: itens.filter((i) => i.contestacao_status === "contestado").length,
      extrasAprovados: itens.reduce((s, i) => s + Number(i.valor_extras), 0),
      glosa: glosas.reduce((s, x) => s + x.g, 0),
      glosaTabela: itens.filter((i) => i.base_origem === "tabela" && i.valor_informado != null && Number(i.valor_informado) > Number(i.valor_base)).reduce((s, i) => s + Number(i.valor_informado) - Number(i.valor_base), 0),
      extrasRecusados: extras.filter((x) => x.status !== "aprovado").reduce((s, x) => s + Number(x.valor), 0),
    };
  }, [itens, extras]);
  const editavel = podeAgir && (e.status === "aguardando" || e.status === "contestado");
  const filtrados = itens.filter((i) => filtro === "todos" ? true : filtro === "conferir" ? i.conferir : !!i.contestacao_status);
  const nfDiferente = e.nf_valor != null && Math.abs(Number(e.nf_valor) - Number(e.total)) >= 0.01;

  const exportar = () => baixarXlsx(`espelho-${(e.fornecedores?.nome ?? "fornecedor").replace(/\s+/g, "-")}-${e.competencia}.xlsx`, "Espelho", [
    { titulo: "Protocolo", largura: 16 }, { titulo: "Data", largura: 16 }, { titulo: "Solicitante", largura: 22 }, { titulo: "Destino", largura: 32 },
    { titulo: "Informado", formato: "moeda", largura: 12 }, { titulo: "Tabela", formato: "moeda", largura: 12 }, { titulo: "Base", formato: "moeda", largura: 12 },
    { titulo: "Origem da base", largura: 12 }, { titulo: "Extras aprovados", formato: "moeda", largura: 14 }, { titulo: "Valor final", formato: "moeda", largura: 13 },
    { titulo: "Glosa", formato: "moeda", largura: 11 }, { titulo: "Contestação", largura: 14 }, { titulo: "Motivo do fornecedor", largura: 30 }, { titulo: "Resposta / ajuste", largura: 30 },
  ], itens.map((i) => [i.corridas?.protocolo, i.corridas ? formatarDataHora(i.corridas.data_hora_prevista) : "", i.corridas?.solicitantes?.nome, i.corridas?.destino,
    i.valor_informado != null ? Number(i.valor_informado) : null, i.valor_tabela != null ? Number(i.valor_tabela) : null, Number(i.valor_base), ORIGEM_BASE[i.base_origem],
    Number(i.valor_extras), Number(i.valor_final), glosaItem({ valor_informado: i.valor_informado != null ? Number(i.valor_informado) : null, valor_base: Number(i.valor_base), valor_final: Number(i.valor_final) }, extrasPedidos(i.corrida_id)) || null,
    i.contestacao_status ? { contestado: "Pendente", aceita: "Aceita", mantida: "Mantida" }[i.contestacao_status] : "", i.contestacao_motivo, i.contestacao_resposta ?? i.ajuste_obs]));

  return (
    <section className="card ordem-detalhe">
      <div className="ordem-detalhe-topo">
        <div>
          <h3>{e.fornecedores?.nome} · competência {nomeCompetencia(e.competencia)}{e.versao > 1 ? ` · versão ${e.versao}` : ""}</h3>
          <p className="pagina-sub">
            <span className={`tag ${STATUS_ESPELHO[e.status].tag}`}>{STATUS_ESPELHO[e.status].rotulo}</span>{" "}
            {e.status === "aguardando" && e.prazo_em && <>Prazo do fornecedor: <strong>{formatarDataHora(e.prazo_em)}</strong>{e.lembrete_enviado_em ? " · lembrete enviado" : ""}. </>}
            {e.aprovado_em && <>Aprovado em {formatarDataHora(e.aprovado_em)}{e.aprovacao === "tacita" ? " (automaticamente, sem resposta no prazo)" : " pelo fornecedor"}. </>}
            {e.pago_em && <>Pago em {formatarData(`${e.pago_em}T12:00:00Z`)}.</>}
          </p>
        </div>
        <div className="row">
          <button type="button" className="ghost" onClick={exportar}>Exportar Excel</button>
          {podeAgir && e.status === "contestado" && (
            <button type="button" className="pri" disabled={ocupado || resumo.contestados > 0} title={resumo.contestados ? "Decida todas as contestações primeiro" : undefined}
              onClick={() => acao(() => chamarApi("/api/espelhos", { acao: "reemitir", espelhoId: e.id }), "Espelho reenviado ao fornecedor com novo prazo.")}>Reenviar ao fornecedor</button>
          )}
        </div>
      </div>
      {ok && <div className="ok">{ok}</div>}
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={brl(e.total)} label={`Total · ${itens.length} corrida(s)`} />
        <KpiCard value={brl(resumo.extrasAprovados)} label="Extras aprovados" />
        <KpiCard value={brl(resumo.glosa)} label={`Glosado (tabela ${brl(resumo.glosaTabela)} · extras ${brl(resumo.extrasRecusados)})`} />
        <KpiCard value={resumo.conferir} label="Sem tabela: conferir" alert={resumo.conferir > 0} />
        <KpiCard value={resumo.contestados} label="Contestações a decidir" alert={resumo.contestados > 0} />
      </div>

      {(e.status === "nf_enviada" || e.status === "pago") && (
        <div className="card" style={{ background: "var(--slate-50)", marginBottom: 12 }}>
          <strong>NF {e.nf_numero}</strong> · {brl(e.nf_valor)} · enviada em {e.nf_enviada_em ? formatarDataHora(e.nf_enviada_em) : "—"}{" "}
          {nfDiferente ? <span className="tag reprovada">Diferente do espelho ({brl(Number(e.nf_valor) - Number(e.total))})</span> : <span className="tag aprovada">Igual ao espelho</span>}{" "}
          {e.nf_arquivo && <button type="button" className="atalho" onClick={() => abrirArquivo(e.nf_arquivo!)}>Abrir PDF</button>}
          {podeAgir && e.status === "nf_enviada" && (
            <form className="row" style={{ marginTop: 10 }} onSubmit={(x) => { x.preventDefault(); void acao(() => chamarApi("/api/espelhos", { acao: "pago", espelhoId: e.id, data: pagoEm }), "Pagamento registrado. O fornecedor foi avisado."); }}>
              <label className="row" style={{ gap: 6 }}>Pago em <input type="date" value={pagoEm} onChange={(x) => setPagoEm(x.target.value)} required /></label>
              <button className="pri" disabled={ocupado}>Marcar como pago</button>
            </form>
          )}
        </div>
      )}

      <div className="repor-filtros">
        <div className="segmentos">
          {([["todos", `Todos (${itens.length})`], ["conferir", `Conferir (${resumo.conferir})`], ["contestados", `Contestados (${itens.filter((i) => i.contestacao_status).length})`]] as const).map(([k, r]) => (
            <button key={k} type="button" className={filtro === k ? "ativo" : ""} onClick={() => setFiltro(k)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="tw">
        <table>
          <thead><tr><th>Corrida</th><th className="num">Informado</th><th className="num">Tabela</th><th className="num">Base</th><th className="num">Extras</th><th className="num">Final</th><th>Contestação / ajuste</th></tr></thead>
          <tbody>
            {filtrados.map((i) => {
              const ed = editando?.id === i.id ? editando : null;
              return (
                <tr key={i.id}>
                  <td>{i.corridas ? <Link href={`/corridas?id=${i.corridas.id}`} className="link-botao protocolo">{i.corridas.protocolo}</Link> : "—"}
                    <small className="bloco texto-fraco">{i.corridas ? formatarDataHora(i.corridas.data_hora_prevista) : ""} · {i.corridas?.solicitantes?.nome}</small>
                    <small className="bloco texto-fraco">{i.corridas?.destino}</small></td>
                  <td className="num">{brl(i.valor_informado)}</td>
                  <td className="num">{i.valor_tabela != null ? brl(i.valor_tabela) : <span className="texto-fraco">—</span>}</td>
                  <td className="num">{brl(i.valor_base)}<small className={`bloco ${i.conferir ? "negative" : "texto-fraco"}`}>{i.conferir ? "Conferir" : ORIGEM_BASE[i.base_origem]}</small></td>
                  <td className="num">{Number(i.valor_extras) ? brl(i.valor_extras) : "—"}</td>
                  <td className="num"><strong>{brl(i.valor_final)}</strong></td>
                  <td style={{ minWidth: 260 }}>
                    {i.ajuste_obs && <small className="bloco texto-fraco">Ajuste: {i.ajuste_obs}</small>}
                    {i.contestacao_status && (
                      <div>
                        <small className="bloco"><strong>Fornecedor pede {brl(i.contestacao_valor)}</strong>: {i.contestacao_motivo}</small>
                        {i.contestacao_status !== "contestado" && <span className={`tag ${i.contestacao_status === "aceita" ? "aprovada" : "reprovada"}`}>{i.contestacao_status === "aceita" ? "Aceita" : "Mantido"}</span>}
                        {i.contestacao_resposta && <small className="bloco texto-fraco">{i.contestacao_resposta}</small>}
                      </div>
                    )}
                    {ed ? (
                      <form className="row" style={{ marginTop: 6 }} onSubmit={(x) => {
                        x.preventDefault();
                        if (ed.tipo === "ajuste") {
                          const v = lerValor(ed.valor);
                          if (v == null) { setErr("Valor inválido. Use o formato 68,50."); return; }
                          void acao(() => rpc("fn_ajustar_item_espelho", { p_item: i.id, p_valor: v, p_obs: ed.obs }), "Valor ajustado.");
                        }
                        else void acao(() => rpc("fn_decidir_contestacao", { p_item: i.id, p_decisao: "mantida", p_resposta: ed.obs }), "Valor mantido.");
                      }}>
                        {ed.tipo === "ajuste" && <input inputMode="decimal" value={ed.valor} onChange={(x) => setEditando({ ...ed, valor: x.target.value })} style={{ width: 90 }} aria-label="Valor" />}
                        <input autoFocus placeholder={ed.tipo === "ajuste" ? "Motivo do ajuste" : "Resposta ao fornecedor"} value={ed.obs} onChange={(x) => setEditando({ ...ed, obs: x.target.value })} style={{ width: 170 }} />
                        <button className={ed.tipo === "ajuste" ? "pri" : "danger"} disabled={ocupado}>{ed.tipo === "ajuste" ? "Salvar" : "Manter"}</button>
                        <button type="button" className="ghost" onClick={() => setEditando(null)}>✕</button>
                      </form>
                    ) : editavel && (
                      <div className="segmentos" style={{ marginTop: 6 }}>
                        {e.status === "contestado" && i.contestacao_status === "contestado" && <>
                          <button type="button" disabled={ocupado} onClick={() => acao(() => rpc("fn_decidir_contestacao", { p_item: i.id, p_decisao: "aceita", p_resposta: null }), "Contestação aceita.")}>Aceitar {brl(i.contestacao_valor)}</button>
                          <button type="button" disabled={ocupado} onClick={() => setEditando({ id: i.id, tipo: "mantida", valor: "", obs: "" })}>Manter</button>
                        </>}
                        {i.contestacao_status !== "contestado" && <button type="button" disabled={ocupado} onClick={() => setEditando({ id: i.id, tipo: "ajuste", valor: String(i.valor_base).replace(".", ","), obs: "" })}>{i.conferir ? "Conferir valor" : "Ajustar"}</button>}
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

      <h3 style={{ marginTop: 24 }}>Histórico</h3>
      <ol className="linha-tempo">
        {eventos.map((ev) => (
          <li key={ev.id} className="evento evento-update">
            <div className="evento-quando"><span>{formatarDataHora(ev.criado_em).slice(6)}</span><small>{formatarDataHora(ev.criado_em).slice(0, 5)}</small></div>
            <div className="evento-corpo">
              <div className="evento-titulo"><span className="evento-area">{ORIGEM_EVENTO[ev.origem] ?? ev.origem}</span>{ev.profiles?.nome && <span className="evento-quem">{ev.profiles.nome}</span>}</div>
              {ev.descricao && <div className="evento-registro">{ev.descricao}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
