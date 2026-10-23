"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { Campo, Filtros, PainelLateral, TopoPagina, normalizarTexto } from "@/components/Formulario";
import { StatusTag } from "@/components/StatusTag";
import { useApp } from "@/components/AuthGate";
import { CANCELAVEIS, EXCECOES, STATUS, type StatusCorrida } from "@/lib/status";
import { brl, dataSP, formatarDataHora, partesSP } from "@/lib/datas";
import { formatarTelefone } from "@/lib/telefone";

type Corrida = {
  id: string; protocolo: string; status: StatusCorrida; tipo: string; data_hora_prevista: string; criado_em: string;
  origem: string; destino: string; qtd_passageiros: number; outros_passageiros: string | null; motivo: string;
  motorista: string | null; veiculo_placa: string | null; eta_minutos: number | null;
  valor_informado: number | null; valor_faturado: number | null; prazo_resposta_em: string | null;
  motivo_recusa: string | null; motivo_cancelamento: string | null;
  solicitante_id: string; fornecedor_id: string | null; centro_custo_id: string | null;
  solicitantes?: { nome: string; setor: string | null; telefone_whatsapp: string } | null;
  fornecedores?: { nome: string } | null;
  centros_custo?: { codigo: string; descricao: string } | null;
};
type Grupo = "todas" | "abertas" | "excecoes" | "validar" | "validadas" | "canceladas";
const GRUPOS: Record<Grupo, (s: StatusCorrida) => boolean> = {
  todas: () => true,
  abertas: (s) => ["solicitada", "enviada", "aceita", "em_andamento"].includes(s),
  excecoes: (s) => EXCECOES.includes(s),
  validar: (s) => s === "concluida",
  validadas: (s) => s === "validada",
  canceladas: (s) => s === "cancelada",
};

const isoDia = (d: Date) => { const p = partesSP(d); return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`; };
const deIso = (s: string, fim = false) => { const [a, m, d] = s.split("-").map(Number); return fim ? dataSP(a, m, d, 23, 59) : dataSP(a, m, d); };

export default function Corridas() {
  const { planejamento } = useApp();
  const [rows, setRows] = useState<Corrida[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string; ativo: boolean }[]>([]);
  const [de, setDe] = useState(() => isoDia(new Date(Date.now() - 30 * 86400_000)));
  const [ate, setAte] = useState(() => isoDia(new Date(Date.now() + 30 * 86400_000)));
  const [grupo, setGrupo] = useState<Grupo>("todas");
  const [fornecedor, setFornecedor] = useState("");
  const [busca, setBusca] = useState("");
  const [err, setErr] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("corridas")
      .select("*, solicitantes(nome,setor,telefone_whatsapp), fornecedores(nome), centros_custo(codigo,descricao)")
      .gte("data_hora_prevista", deIso(de).toISOString()).lte("data_hora_prevista", deIso(ate, true).toISOString())
      .order("data_hora_prevista", { ascending: false }).limit(1000);
    setErr(error ? `Não foi possível carregar as corridas: ${error.message}` : "");
    setRows((data ?? []) as Corrida[]);
    setCarregando(false);
  };
  useEffect(() => { void carregar(); }, [de, ate]);
  useEffect(() => {
    supabase.from("fornecedores").select("id,nome,ativo").order("nome").then(({ data }) => setFornecedores(data ?? []));
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setAberta(id);
    const t = setInterval(() => void carregar(), 20_000);
    return () => clearInterval(t);
  }, []);

  const termo = normalizarTexto(busca);
  const daBusca = rows.filter((c) => (!fornecedor || c.fornecedor_id === fornecedor)
    && (!termo || normalizarTexto(`${c.protocolo} ${c.solicitantes?.nome ?? ""} ${c.origem} ${c.destino} ${c.motivo}`).includes(termo)));
  const lista = daBusca.filter((c) => GRUPOS[grupo](c.status));
  const conta = (g: Grupo) => daBusca.filter((c) => GRUPOS[g](c.status)).length;
  const total = lista.reduce((s, c) => s + Number(c.valor_informado ?? 0), 0);

  const abrir = (id: string | null) => {
    setAberta(id);
    window.history.replaceState(null, "", id ? `/corridas?id=${id}` : "/corridas");
  };

  return (
    <>
      <TopoPagina titulo="Corridas" subtitulo="Toda corrida nasce com protocolo. Clique numa linha para ver o detalhe e tratar." />
      {err && <div className="err">{err}</div>}
      <section className="card">
        <div className="filtros-corridas">
          <label>De<input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
          <label>Até<input type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
          <label>Fornecedor
            <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}>
              <option value="">Todos</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <input type="search" placeholder="Buscar protocolo, solicitante, endereço ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="repor-filtros">
          <Filtros<Grupo> rotulo="Situação" valor={grupo} onChange={setGrupo} opcoes={[
            ["todas", "Todas", conta("todas")], ["abertas", "Em aberto", conta("abertas")], ["excecoes", "Exceções", conta("excecoes")],
            ["validar", "A validar", conta("validar")], ["validadas", "Validadas", conta("validadas")], ["canceladas", "Canceladas", conta("canceladas")],
          ]} />
          <span className="texto-fraco">{lista.length} corrida(s) · valor informado {brl(total)}</span>
        </div>
        <div className="tw">
          <table>
            <thead><tr><th>Protocolo</th><th>Data/hora</th><th>Solicitante</th><th>Origem → destino</th><th>Fornecedor</th><th>Status</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="linha-clicavel" tabIndex={0} onClick={() => abrir(c.id)} onKeyDown={(e) => e.key === "Enter" && abrir(c.id)}>
                  <td><span className="protocolo">{c.protocolo}</span></td>
                  <td className="data-celula"><span>{formatarDataHora(c.data_hora_prevista)}</span><small>{c.tipo === "agendada" ? "Agendada" : "Imediata"}</small></td>
                  <td>{c.solicitantes?.nome ?? "—"}<small className="bloco texto-fraco">{c.solicitantes?.setor ?? ""}</small></td>
                  <td className="trajeto">{c.origem}<small>→ {c.destino}</small></td>
                  <td>{c.fornecedores?.nome ?? <span className="texto-fraco">—</span>}</td>
                  <td><StatusTag status={c.status} /></td>
                  <td className="num">{brl(c.valor_informado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!lista.length && <p className="empty">{carregando ? "Carregando…" : "Nenhuma corrida neste filtro."}</p>}
      </section>

      {aberta && <Detalhe id={aberta} fornecedores={fornecedores} podeAgir={planejamento} onFechar={() => abrir(null)} onMudou={carregar} />}
    </>
  );
}

type Evento = { id: string; status_anterior: StatusCorrida | null; status_novo: StatusCorrida; origem: string; observacao: string | null; criado_em: string; profiles?: { nome: string } | null };
type Mensagem = { id: string; direcao: string; canal: string; telefone: string; template: string | null; conteudo: any; status_envio: string | null; erro: string | null; criado_em: string };
type AcaoForm = null | "contestar" | "reabrir" | "cancelar" | "reenviar" | "ajustar_valor";
const ORIGENS: Record<string, string> = { bot: "Bot", fornecedor: "Fornecedor", planejamento: "Planejamento", sistema: "Sistema" };

function Detalhe({ id, fornecedores, podeAgir, onFechar, onMudou }: {
  id: string; fornecedores: { id: string; nome: string; ativo: boolean }[]; podeAgir: boolean; onFechar: () => void; onMudou: () => void;
}) {
  const [c, setC] = useState<Corrida | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [acao, setAcao] = useState<AcaoForm>(null);
  const [obs, setObs] = useState("");
  const [valor, setValor] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const carregar = async () => {
    const [r, ev, ms] = await Promise.all([
      supabase.from("corridas").select("*, solicitantes(nome,setor,telefone_whatsapp), fornecedores(nome), centros_custo(codigo,descricao)").eq("id", id).maybeSingle(),
      supabase.from("corrida_eventos").select("*, profiles(nome)").eq("corrida_id", id).order("criado_em", { ascending: false }),
      supabase.from("mensagens").select("*").eq("corrida_id", id).order("criado_em"),
    ]);
    if (r.error) setErr(r.error.message);
    setC((r.data as Corrida) ?? null);
    setEventos((ev.data ?? []) as Evento[]);
    setMensagens((ms.data ?? []) as Mensagem[]);
  };
  useEffect(() => { setAcao(null); setErr(""); setOk(""); void carregar(); }, [id]);

  const executar = async (nome: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true); setErr(""); setOk("");
    try {
      const r = await chamarApi("/api/corridas/acao", { corridaId: id, acao: nome, obs, ...extra });
      setOk(r.mensagens ? `Feito. ${r.mensagens} mensagem(ns) enviada(s).` : "Feito.");
      setAcao(null); setObs(""); setValor("");
      await carregar(); onMudou();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(false);
    }
  };

  if (!c) return <PainelLateral titulo="Corrida" onFechar={onFechar}><div className="painel-corpo"><p className="empty">{err || "Carregando…"}</p></div></PainelLateral>;

  const pode = {
    validar: ["concluida", "contestada"].includes(c.status),
    contestar: c.status === "concluida",
    reabrir: c.status === "validada",
    cancelar: CANCELAVEIS.includes(c.status),
    reenviar: ["recusada", "sem_resposta", "enviada", "solicitada"].includes(c.status),
    ajustar_valor: ["concluida", "contestada", "em_andamento", "aceita"].includes(c.status),
  };
  const outros = fornecedores.filter((f) => f.ativo);

  return (
    <PainelLateral titulo={c.protocolo} subtitulo={<><StatusTag status={c.status} /> {STATUS[c.status].ajuda}</>} onFechar={onFechar} ocupado={ocupado} largura={700}>
      <div className="painel-corpo">
        {ok && <div className="ok">{ok}</div>}
        {err && <div className="err">{err}</div>}

        {podeAgir && Object.values(pode).some(Boolean) && (
          <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <legend>Ações</legend>
            <div className="acoes-corrida">
              {pode.validar && <button type="button" className="pri" disabled={ocupado} onClick={() => executar("validar")}>Validar corrida</button>}
              {pode.reenviar && <button type="button" className={pode.validar ? "ghost" : "pri"} disabled={ocupado} onClick={() => { setAcao("reenviar"); setFornecedorId(outros.find((f) => f.id !== c.fornecedor_id)?.id ?? ""); }}>Reenviar a fornecedor</button>}
              {pode.ajustar_valor && <button type="button" className="ghost" disabled={ocupado} onClick={() => { setAcao("ajustar_valor"); setValor(c.valor_informado != null ? String(c.valor_informado).replace(".", ",") : ""); }}>Ajustar valor</button>}
              {pode.contestar && <button type="button" className="ghost botao-perigo" disabled={ocupado} onClick={() => setAcao("contestar")}>Contestar</button>}
              {pode.reabrir && <button type="button" className="ghost botao-perigo" disabled={ocupado} onClick={() => setAcao("reabrir")}>Reabrir (contestar)</button>}
              {pode.cancelar && <button type="button" className="ghost botao-perigo" disabled={ocupado} onClick={() => setAcao("cancelar")}>Cancelar corrida</button>}
            </div>
            {acao && (
              <form className="form-mov" onSubmit={(e) => {
                e.preventDefault();
                if (acao === "reenviar") void executar("reenviar", { fornecedorId });
                else if (acao === "ajustar_valor") void executar("ajustar_valor", { valor: Number(valor.replace(/\./g, "").replace(",", ".")) });
                else void executar(acao);
              }}>
                {acao === "reenviar" && (
                  <Campo rotulo="Fornecedor" obrigatorio ajuda="O fornecedor recebe o modelo com os botões Aceitar e Recusar, e o solicitante é avisado.">
                    <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} required>
                      <option value="">Selecione</option>
                      {outros.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.id === c.fornecedor_id ? " (atual)" : ""}</option>)}
                    </select>
                  </Campo>
                )}
                {acao === "ajustar_valor" && (
                  <Campo rotulo="Novo valor (R$)" obrigatorio><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
                )}
                <Campo rotulo={acao === "cancelar" ? "Motivo do cancelamento" : acao === "reenviar" ? "Observação" : "Motivo"} obrigatorio={acao !== "reenviar"}
                  ajuda={acao === "cancelar" ? "O solicitante e, se a corrida já tinha sido enviada, o fornecedor são avisados pelo WhatsApp." : undefined}>
                  <input value={obs} onChange={(e) => setObs(e.target.value)} required={acao !== "reenviar"} maxLength={300} />
                </Campo>
                <div className="row">
                  <button className={acao === "cancelar" || acao === "contestar" || acao === "reabrir" ? "danger" : "pri"} disabled={ocupado}>
                    {ocupado ? "Aguarde…" : { contestar: "Contestar", reabrir: "Reabrir como contestada", cancelar: "Cancelar corrida", reenviar: "Enviar ao fornecedor", ajustar_valor: "Salvar valor" }[acao]}
                  </button>
                  <button type="button" className="ghost" onClick={() => { setAcao(null); setObs(""); }} disabled={ocupado}>Voltar</button>
                </div>
              </form>
            )}
          </fieldset>
        )}

        <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <legend>Dados da corrida</legend>
          <dl className="dl">
            <dt>Solicitante</dt><dd>{c.solicitantes?.nome ?? "—"}{c.solicitantes?.setor ? ` · ${c.solicitantes.setor}` : ""}{c.solicitantes?.telefone_whatsapp ? <><br /><small className="texto-fraco">{formatarTelefone(c.solicitantes.telefone_whatsapp)}</small></> : null}</dd>
            <dt>Data/hora prevista</dt><dd>{formatarDataHora(c.data_hora_prevista)} · {c.tipo === "agendada" ? "agendada" : "imediata"}</dd>
            <dt>Origem</dt><dd>{c.origem}</dd>
            <dt>Destino</dt><dd>{c.destino}</dd>
            <dt>Passageiros</dt><dd>{c.qtd_passageiros}{c.outros_passageiros ? ` · ${c.outros_passageiros}` : ""}</dd>
            <dt>Centro de custo</dt><dd>{c.centros_custo ? `${c.centros_custo.codigo} · ${c.centros_custo.descricao}` : "—"}</dd>
            <dt>Motivo</dt><dd>{c.motivo}</dd>
            <dt>Fornecedor</dt><dd>{c.fornecedores?.nome ?? "—"}{c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? <small className="bloco texto-fraco">Prazo de resposta: {formatarDataHora(c.prazo_resposta_em)}</small> : null}</dd>
            <dt>Motorista</dt><dd>{c.motorista ? [c.motorista, c.veiculo_placa, c.eta_minutos ? `${c.eta_minutos} min` : null].filter(Boolean).join(" · ") : <span className="texto-fraco">Ainda não informado</span>}</dd>
            <dt>Valor informado</dt><dd>{brl(c.valor_informado)}</dd>
            <dt>Valor faturado</dt><dd>{brl(c.valor_faturado)}</dd>
            {c.motivo_cancelamento && <><dt>Cancelamento</dt><dd>{c.motivo_cancelamento}</dd></>}
          </dl>
        </fieldset>

        <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <legend>Linha do tempo</legend>
          <ol className="linha-tempo">
            {eventos.map((ev) => (
              <li key={ev.id} className={`evento ${ev.status_novo === "cancelada" || ev.status_novo === "recusada" ? "evento-delete" : ev.status_anterior === null ? "evento-insert" : "evento-update"}`}>
                <div className="evento-quando"><span>{formatarDataHora(ev.criado_em).slice(6)}</span><small>{formatarDataHora(ev.criado_em).slice(0, 5)}</small></div>
                <div className="evento-corpo">
                  <div className="evento-titulo">
                    <span className="evento-acao">{ev.status_anterior && ev.status_anterior !== ev.status_novo ? `${STATUS[ev.status_anterior].rotulo} → ${STATUS[ev.status_novo].rotulo}` : ev.status_anterior ? "Atualização" : STATUS[ev.status_novo].rotulo}</span>
                    <span className="evento-area">{ORIGENS[ev.origem] ?? ev.origem}</span>
                    {ev.profiles?.nome && <span className="evento-quem">{ev.profiles.nome}</span>}
                  </div>
                  {ev.observacao && <div className="evento-registro">{ev.observacao}</div>}
                </div>
              </li>
            ))}
          </ol>
        </fieldset>

        <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)", marginBottom: 18 }}>
          <legend>Mensagens desta corrida</legend>
          {mensagens.length ? (
            <div className="conversa-mini">
              {mensagens.map((m) => (
                <div key={m.id} className={`bolha ${m.direcao === "entrada" ? "entrada" : "saida"}${m.status_envio === "falhou" ? " erro" : ""}`}>
                  <span className="modelo">{m.direcao === "saida" ? `Para ${formatarTelefone(m.telefone)}` : `De ${formatarTelefone(m.telefone)}`}{m.template ? ` · modelo ${m.template}` : ""}{m.canal === "simulado" ? " · simulado" : ""}</span>
                  {m.conteudo?.texto ?? m.conteudo?.botaoId ?? ""}
                  {m.erro && <span className="campo-erro bloco">Falha no envio: {m.erro}</span>}
                  <span className="hora">{formatarDataHora(m.criado_em)}</span>
                </div>
              ))}
            </div>
          ) : <p className="secao-ajuda">Nenhuma mensagem vinculada.</p>}
        </fieldset>
      </div>
    </PainelLateral>
  );
}
