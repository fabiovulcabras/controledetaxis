"use client";
import { paradasDa, trajetoTexto } from "@/lib/multidestino";
import { formatarPlaca } from "@/lib/motorista";
import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { Campo, Filtros, PainelLateral, TopoPagina } from "@/components/Formulario";
import { StatusTag } from "@/components/StatusTag";
import Prazo from "@/components/Prazo";
import { useApp } from "@/components/AuthGate";
import ExtrasCorrida from "@/components/ExtrasCorrida";
import { useRetorno } from "@/components/Retorno";
import { useTempoReal } from "@/lib/hooks/useTempoReal";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";
import { CANCELAVEIS, EXCECOES, STATUS, type StatusCorrida } from "@/lib/status";
import { brl, dataSP, formatarDataHora, partesSP } from "@/lib/datas";
import { formatarTelefone } from "@/lib/telefone";
import { linkWhatsApp, msgNovaCorridaFornecedor } from "@/lib/whatsapp/link";
import { baixarXlsx } from "@/lib/xlsx";
import { valorEsperado } from "@/lib/bot/acoes";
import { valorPorKm } from "@/lib/comparativo-km";

type Corrida = {
  id: string; protocolo: string; status: StatusCorrida; tipo: string; data_hora_prevista: string; criado_em: string;
  origem: string; destino: string; qtd_passageiros: number; outros_passageiros: string | null; motivo: string; observacoes?: string | null;
  motorista: string | null; veiculo_placa: string | null; eta_minutos: number | null;
  valor_informado: number | null; valor_faturado: number | null; prazo_resposta_em: string | null;
  motivo_recusa: string | null; motivo_cancelamento: string | null; distancia_km?: number | null;
  valor_tabela?: number | null; preco_descricao?: string | null; preco_calculado_em?: string | null;
  solicitante_id: string; fornecedor_id: string | null;
  solicitantes?: { nome: string; setor: string | null; telefone_whatsapp: string } | null;
  fornecedores?: { nome: string; telefone_whatsapp?: string; bandeirada?: number | null; valor_km?: number | null } | null;
  token_fornecedor?: string;
};
/** Linha da view corridas_lista (nomes já juntados). */
type Linha = Omit<Corrida, "solicitantes" | "fornecedores"> & {
  solicitante_nome: string; solicitante_setor: string | null; fornecedor_nome: string | null;
  fornecedor_valor_km?: number | null; fornecedor_bandeirada?: number | null; distancia_fonte?: string | null;
};

const fmtKm = (km: number | null | undefined) => km == null ? null : `${Number(km).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
/** Valor pela tarifa por km do fornecedor da linha (bandeirada + km × valor por km). */
const porKmDaLinha = (c: Pick<Linha, "distancia_km" | "fornecedor_valor_km" | "fornecedor_bandeirada">) =>
  valorPorKm(c.distancia_km ?? null, { valor_km: c.fornecedor_valor_km ?? null, bandeirada: c.fornecedor_bandeirada ?? null });
/** Diferença do valor por km para a tabela: positiva = por km sairia mais caro. */
function DifKm({ porKm, tabela }: { porKm: number | null; tabela: number | null | undefined }) {
  if (porKm == null || tabela == null) return null;
  const d = Math.round((porKm - Number(tabela)) * 100) / 100;
  if (Math.abs(d) < 0.01) return <small className="bloco texto-fraco">igual à tabela</small>;
  return <small className={`bloco ${d > 0 ? "negative" : "positive"}`}>{d > 0 ? "+" : ""}{brl(d)} vs tabela</small>;
}
type Grupo = "todas" | "abertas" | "excecoes" | "validar" | "validadas" | "canceladas";
const GRUPOS: Record<Grupo, StatusCorrida[] | null> = {
  todas: null,
  abertas: ["solicitada", "enviada", "aceita", "em_andamento"],
  excecoes: EXCECOES,
  validar: ["concluida"],
  validadas: ["validada"],
  canceladas: ["cancelada"],
};
const POR_PAGINA = 50;
/** Valor informado acima da tabela de preços do fornecedor. */
const acimaDaTabela = (c: { valor_informado: number | null; valor_tabela?: number | null }) =>
  c.valor_informado != null && c.valor_tabela != null && Number(c.valor_informado) > Number(c.valor_tabela) + 0.005;

const isoDia = (d: Date) => { const p = partesSP(d); return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`; };
const deIso = (s: string, fim = false) => { const [a, m, d] = s.split("-").map(Number); return fim ? dataSP(a, m, d, 23, 59) : dataSP(a, m, d); };
const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export default function Corridas() {
  const { planejamento } = useApp();
  const { avisar } = useRetorno();
  const [rows, setRows] = useState<Linha[]>([]);
  const [total, setTotal] = useState(0);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [pagina, setPagina] = useState(0);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string; ativo: boolean }[]>([]);
  const [de, setDe] = useState(() => isoDia(new Date(Date.now() - 30 * 86400_000)));
  const [ate, setAte] = useState(() => isoDia(new Date(Date.now() + 30 * 86400_000)));
  const [grupo, setGrupo] = useState<Grupo>("todas");
  const [fornecedor, setFornecedor] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [err, setErr] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  // Espera a pessoa parar de digitar antes de buscar no banco
  useEffect(() => { const t = setTimeout(() => setBuscaAplicada(busca), 350); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { setPagina(0); }, [de, ate, grupo, fornecedor, buscaAplicada]);

  /** Mesma consulta para a lista e para a exportação. */
  const consulta = (campos: string, contar = false) => {
    let q = supabase.from("corridas_lista").select(campos, contar ? { count: "exact" } : undefined)
      .gte("data_hora_prevista", deIso(de).toISOString()).lte("data_hora_prevista", deIso(ate, true).toISOString());
    const sts = GRUPOS[grupo];
    if (sts) q = q.in("status", sts);
    if (fornecedor) q = q.eq("fornecedor_id", fornecedor);
    if (buscaAplicada.trim()) q = q.like("busca", `%${semAcento(buscaAplicada)}%`);
    return q.order("data_hora_prevista", { ascending: false });
  };

  const carregar = async () => {
    setCarregando(true);
    const [lista, cont] = await Promise.all([
      consulta("*", true).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1),
      supabase.rpc("fn_contar_corridas", { p_de: deIso(de).toISOString(), p_ate: deIso(ate, true).toISOString(), p_fornecedor: fornecedor || null, p_busca: buscaAplicada.trim() || null }),
    ]);
    const erro = lista.error ?? cont.error;
    setErr(erro ? `Não foi possível carregar as corridas: ${erro.message}${/does not exist|could not find/i.test(erro.message) ? " — rode a migração supabase/003_melhorias.sql." : ""}` : "");
    setRows((lista.data ?? []) as unknown as Linha[]);
    setTotal(lista.count ?? 0);
    setContagem(((cont.data as any)?.por_status ?? {}) as Record<string, number>);
    setCarregando(false);
  };
  useEffect(() => { void carregar(); }, [de, ate, grupo, fornecedor, buscaAplicada, pagina]);
  useEffect(() => {
    supabase.from("fornecedores").select("id,nome,ativo").order("nome").then(({ data }) => setFornecedores(data ?? []));
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setAberta(id);
  }, []);
  useTempoReal(["corridas"], () => void carregar());
  useIntervaloVisivel(() => void carregar(), 120_000);

  const conta = (g: Grupo) => (GRUPOS[g] ?? Object.keys(contagem) as StatusCorrida[]).reduce((n, s) => n + (contagem[s] ?? 0), 0);
  const valorPagina = rows.reduce((s, c) => s + Number(c.valor_informado ?? 0), 0);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const abrir = (id: string | null) => {
    setAberta(id);
    window.history.replaceState(null, "", id ? `/corridas?id=${id}` : "/corridas");
  };

  const [completando, setCompletando] = useState(false);
  /** Calcula km e valor da tabela das corridas do período (filtros de data e fornecedor) que ainda não têm. */
  /** `todas`: refaz o km de todas as corridas do período pelo menor trajeto (não só das que estão sem). */
  const completar = async (todas = false) => {
    setCompletando(true);
    const pular: string[] = [];
    let km = 0, tabelas = 0, apos: string | null = null;
    try {
      for (let rodada = 0; rodada < 400; rodada++) {
        const r: { calculadas: number; tabelas: number; falharam: string[]; restantes: number; apos: string | null } = await chamarApi("/api/corridas/km", {
          de: deIso(de).toISOString(), ate: new Date(deIso(ate, true).getTime() + 60_000).toISOString(), fornecedorId: fornecedor || null,
          ...(todas ? { todas: true, apos } : { pular }),
        });
        km += r.calculadas; tabelas += r.tabelas; pular.push(...r.falharam); apos = r.apos;
        if (!r.restantes) break;
      }
      avisar(`Km calculado em ${km} corrida(s) e tabela em ${tabelas}.${pular.length ? ` ${pular.length} ficaram sem rota ou sem preço na tabela do fornecedor.` : ""}`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "Não foi possível calcular.", "erro");
    } finally { setCompletando(false); await carregar(); }
  };

  const exportar = async () => {
    setExportando(true);
    const { data, error } = await consulta("protocolo,data_hora_prevista,tipo,solicitante_nome,solicitante_setor,origem,destino,qtd_passageiros,motivo,observacoes,fornecedor_nome,status,motorista,veiculo_placa,distancia_km,distancia_fonte,fornecedor_valor_km,fornecedor_bandeirada,valor_tabela,preco_descricao,valor_informado,valor_faturado").limit(10000);
    setExportando(false);
    if (error) { avisar(`Não foi possível exportar: ${error.message}`, "erro"); return; }
    const linhas = (data ?? []) as any[];
    baixarXlsx(`corridas-${de}-a-${ate}.xlsx`, "Corridas", [
      { titulo: "Protocolo", largura: 16 }, { titulo: "Data/hora", largura: 14 }, { titulo: "Tipo", largura: 10 }, { titulo: "Solicitante", largura: 22 },
      { titulo: "Setor", largura: 14 }, { titulo: "Origem", largura: 36 }, { titulo: "Destino", largura: 36 }, { titulo: "Passageiros", formato: "inteiro", largura: 11 },
      { titulo: "Motivo", largura: 20 }, { titulo: "Observações", largura: 30 }, { titulo: "Fornecedor", largura: 20 }, { titulo: "Status", largura: 18 },
      { titulo: "Motorista", largura: 18 }, { titulo: "Placa", largura: 10 }, { titulo: "Distância (km)", formato: "decimal", largura: 13 },
      { titulo: "Valor tabela", formato: "moeda", largura: 13 }, { titulo: "Item da tabela", largura: 34 },
      { titulo: "Valor por km", formato: "moeda", largura: 13 }, { titulo: "Por km − tabela", formato: "moeda", largura: 15 }, { titulo: "Km estimado?", largura: 12 },
      { titulo: "Valor informado", formato: "moeda", largura: 15 }, { titulo: "Valor faturado", formato: "moeda", largura: 15 },
    ], linhas.map((c) => [
      c.protocolo, formatarDataHora(c.data_hora_prevista), c.tipo === "agendada" ? "Agendada" : "Imediata", c.solicitante_nome, c.solicitante_setor,
      c.origem, trajetoTexto(c), c.qtd_passageiros, c.motivo, c.observacoes, c.fornecedor_nome, STATUS[c.status as StatusCorrida]?.rotulo ?? c.status,
      c.motorista, c.veiculo_placa, c.distancia_km == null ? null : Number(c.distancia_km),
      c.valor_tabela == null ? null : Number(c.valor_tabela), c.preco_descricao,
      porKmDaLinha(c), porKmDaLinha(c) != null && c.valor_tabela != null ? Math.round((porKmDaLinha(c)! - Number(c.valor_tabela)) * 100) / 100 : null,
      c.distancia_fonte === "estimada" ? "Sim" : "", c.valor_informado == null ? null : Number(c.valor_informado),
      c.valor_faturado == null ? null : Number(c.valor_faturado),
    ]));
    avisar(`${linhas.length} corrida(s) exportada(s).`);
  };

  return (
    <>
      <TopoPagina titulo="Corridas" subtitulo="Toda corrida nasce com protocolo. A lista atualiza sozinha quando algo muda.">
        {planejamento && <button type="button" className="ghost" onClick={() => completar()} disabled={completando || !total} title="Calcula a distância por ruas (menor trajeto) e o valor da tabela das corridas do período que ainda não têm">{completando ? "Calculando…" : "Calcular km e tabela"}</button>}
        {planejamento && <button type="button" className="ghost" onClick={() => completar(true)} disabled={completando || !total} title="Refaz o km de todas as corridas do período pelo trajeto de menor distância">Refazer km (menor trajeto)</button>}
        <button type="button" className="ghost" onClick={exportar} disabled={exportando || !total}>{exportando ? "Exportando…" : "Exportar Excel"}</button>
      </TopoPagina>
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
          <input type="search" placeholder="Buscar protocolo, solicitante, setor, endereço ou motivo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="repor-filtros">
          <Filtros<Grupo> rotulo="Situação" valor={grupo} onChange={setGrupo} opcoes={[
            ["todas", "Todas", conta("todas")], ["abertas", "Em aberto", conta("abertas")], ["excecoes", "Exceções", conta("excecoes")],
            ["validar", "A validar", conta("validar")], ["validadas", "Validadas", conta("validadas")], ["canceladas", "Canceladas", conta("canceladas")],
          ]} />
          <span className="texto-fraco">{total} corrida(s){rows.length ? ` · nesta página ${brl(valorPagina)}` : ""}</span>
        </div>

        <div className="tw so-tela-larga">
          <table>
            <thead><tr><th>Protocolo</th><th>Data/hora</th><th>Solicitante</th><th>Origem → destino</th><th>Fornecedor</th><th>Status</th><th className="num">Km</th><th className="num">Tabela</th><th className="num">Por km</th><th className="num">Informado</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="linha-clicavel" tabIndex={0} onClick={() => abrir(c.id)} onKeyDown={(e) => e.key === "Enter" && abrir(c.id)}>
                  <td><span className="protocolo">{c.protocolo}</span></td>
                  <td className="data-celula"><span>{formatarDataHora(c.data_hora_prevista)}</span><small>{c.tipo === "agendada" ? "Agendada" : "Imediata"}</small></td>
                  <td>{c.solicitante_nome}<small className="bloco texto-fraco">{c.solicitante_setor ?? ""}</small></td>
                  <td className="trajeto">{c.origem}<small>→ {trajetoTexto(c)}</small></td>
                  <td>{c.fornecedor_nome ?? <span className="texto-fraco">—</span>}</td>
                  <td><StatusTag status={c.status} />{["enviada", "sem_resposta"].includes(c.status) && <div><Prazo ate={c.prazo_resposta_em} compacto /></div>}</td>
                  <td className="num">{fmtKm(c.distancia_km) ?? <span className="texto-fraco">—</span>}{c.distancia_fonte === "estimada" && <small className="bloco texto-fraco">estimado</small>}</td>
                  <td className="num">{c.valor_tabela != null ? brl(c.valor_tabela) : <span className="texto-fraco">—</span>}</td>
                  <td className="num">{(() => { const v = porKmDaLinha(c); return v != null ? <>{brl(v)}<DifKm porKm={v} tabela={c.valor_tabela} /></> : <span className="texto-fraco">—</span>; })()}</td>
                  <td className="num">{brl(c.valor_informado)}{acimaDaTabela(c) && <small className="bloco acima-tabela">acima da tabela</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cartoes-corridas so-celular">
          {rows.map((c) => (
            <button key={c.id} type="button" className="cartao-corrida" onClick={() => abrir(c.id)}>
              <div className="cartao-corrida-topo"><span className="protocolo">{c.protocolo}</span><StatusTag status={c.status} /></div>
              <div className="cartao-corrida-trajeto">{c.origem}<small>→ {trajetoTexto(c)}</small></div>
              <div className="cartao-corrida-rodape">
                <span>{formatarDataHora(c.data_hora_prevista)} · {c.solicitante_nome}</span>
                <b>{brl(c.valor_informado)}{acimaDaTabela(c) && <small className="bloco acima-tabela">tabela {brl(c.valor_tabela)}</small>}</b>
              </div>
              {(c.distancia_km != null || c.valor_tabela != null) && (
                <div className="cartao-corrida-comparativo">
                  <span>{fmtKm(c.distancia_km) ?? "km —"}</span>
                  <span>Tabela {c.valor_tabela != null ? brl(c.valor_tabela) : "—"}</span>
                  <span>Por km {(() => { const v = porKmDaLinha(c); return v != null ? brl(v) : "—"; })()}</span>
                </div>
              )}
              {["enviada", "sem_resposta"].includes(c.status) && <Prazo ate={c.prazo_resposta_em} />}
            </button>
          ))}
        </div>

        {!rows.length && <p className="empty">{carregando ? "Carregando…" : "Nenhuma corrida neste filtro."}</p>}
        {total > POR_PAGINA && (
          <div className="paginacao">
            <button type="button" className="ghost" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <span>Página {pagina + 1} de {paginas}</span>
            <button type="button" className="ghost" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
          </div>
        )}
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
  const [links, setLinks] = useState<{ rotulo: string; url: string }[]>([]);

  const carregar = async () => {
    const [r, ev, ms] = await Promise.all([
      supabase.from("corridas").select("*, solicitantes(nome,setor,telefone_whatsapp), fornecedores(nome,telefone_whatsapp,bandeirada,valor_km)").eq("id", id).maybeSingle(),
      supabase.from("corrida_eventos").select("*, profiles(nome)").eq("corrida_id", id).order("criado_em", { ascending: false }),
      supabase.from("mensagens").select("*").eq("corrida_id", id).order("criado_em"),
    ]);
    if (r.error) setErr(r.error.message);
    setC((r.data as Corrida) ?? null);
    setEventos((ev.data ?? []) as Evento[]);
    setMensagens((ms.data ?? []) as Mensagem[]);
  };
  useEffect(() => { setAcao(null); setErr(""); setOk(""); setLinks([]); void carregar(); }, [id]);
  useTempoReal(["corridas", "corrida_eventos", "mensagens"], () => void carregar());

  const recalcularKm = async () => {
    setOcupado(true); setErr(""); setOk("");
    try {
      const r = await chamarApi<{ calculadas: number; falharam: string[] }>("/api/corridas/km", { ids: [id] });
      setOk(r.calculadas ? (r.falharam.length ? "Distância estimada (linha reta × 1,3): o mapa não achou a rota. Confira os endereços." : "Distância recalculada pela rota.") : "Não achei os endereços no mapa. Ajuste a origem ou o destino com um endereço mais completo.");
      await carregar(); onMudou();
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível calcular."); }
    finally { setOcupado(false); }
  };
  const executar = async (nome: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true); setErr(""); setOk("");
    try {
      const r = await chamarApi("/api/corridas/acao", { corridaId: id, acao: nome, obs, ...extra });
      setLinks(r.links ?? []);
      setOk(nome === "recalcular_preco"
        ? (r.valor_tabela != null ? `Valor da tabela: ${brl(r.valor_tabela)} (${r.descricao}).` : "Nenhum valor encontrado: confira se este fornecedor tem linha para a cidade/bairro do trecho em Cadastros › Tabela de preços.")
        : r.mensagens ? `Feito. ${r.mensagens} mensagem(ns) enviada(s).` : r.links?.length ? "Feito. Avise pelo WhatsApp com os botões abaixo." : "Feito.");
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
        {links.map((l) => <a key={l.url} className="botao-whatsapp" href={l.url} target="_blank" rel="noopener noreferrer">{l.rotulo}</a>)}
        {err && <div className="err">{err}</div>}

        {podeAgir && (
          <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <legend>WhatsApp</legend>
            <div className="acoes-corrida">
              {c.fornecedores?.telefone_whatsapp && c.token_fornecedor && ["solicitada", "enviada", "sem_resposta"].includes(c.status) && (
                <a className="ghost" target="_blank" rel="noopener noreferrer"
                  href={linkWhatsApp(c.fornecedores.telefone_whatsapp, msgNovaCorridaFornecedor(c as any, c.solicitantes?.nome ?? "-", window.location.origin))}>Enviar corrida ao fornecedor</a>
              )}
              {c.fornecedores?.telefone_whatsapp && <a className="ghost" target="_blank" rel="noopener noreferrer" href={linkWhatsApp(c.fornecedores.telefone_whatsapp, `Sobre a corrida ${c.protocolo}: `)}>Falar com {c.fornecedores.nome}</a>}
              {c.solicitantes?.telefone_whatsapp && <a className="ghost" target="_blank" rel="noopener noreferrer" href={linkWhatsApp(c.solicitantes.telefone_whatsapp, `Sobre a sua corrida ${c.protocolo}: `)}>Falar com {c.solicitantes.nome.split(" ")[0]}</a>}
              {c.token_fornecedor && <a className="ghost" target="_blank" rel="noopener noreferrer" href={`/f/${c.token_fornecedor}`}>Página do fornecedor</a>}
            </div>
          </fieldset>
        )}

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
            {paradasDa(c).map((p, i) => <Fragment key={i}><dt>Parada {i + 1}</dt><dd>{p.texto}</dd></Fragment>)}
            <dt>{paradasDa(c).length ? "Destino final" : "Destino"}</dt><dd>{c.destino}{paradasDa(c).length > 0 && <small className="bloco texto-fraco">o mais longe da origem; paradas na ordem de menor km, e o valor de tabela é o deste destino</small>}</dd>
            <dt>Passageiros</dt><dd>{c.qtd_passageiros}{c.outros_passageiros ? ` · ${c.outros_passageiros}` : ""}</dd>
            <dt>Motivo</dt><dd>{c.motivo}</dd>
            {c.observacoes && <><dt>Observações</dt><dd className="observacoes-corrida">{c.observacoes}</dd></>}
            <dt>Fornecedor</dt><dd>{c.fornecedores?.nome ?? "—"}{c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? <span className="bloco"><Prazo ate={c.prazo_resposta_em} /></span> : null}</dd>
            <dt>Motorista</dt><dd>{c.motorista ? [c.motorista, c.veiculo_placa ? formatarPlaca(c.veiculo_placa) : null, c.eta_minutos != null ? `chegada em ${c.eta_minutos} min após o aceite` : null].filter(Boolean).join(" · ") : <span className="texto-fraco">Ainda não informado (a corrida só é confirmada com motorista, placa e horário)</span>}</dd>
            <dt>{paradasDa(c).length ? "Km rodado (com paradas)" : "Distância (trajeto)"}</dt><dd>{c.distancia_km != null ? <>{fmtKm(c.distancia_km)}{(c as any).distancia_fonte === "estimada" && <small className="bloco texto-fraco">estimada (linha reta × 1,3)</small>}</> : <span className="texto-fraco">Ainda não calculada</span>}
              {podeAgir && <button type="button" className="atalho bloco" disabled={ocupado} onClick={recalcularKm}>{c.distancia_km != null ? "Recalcular km" : "Calcular km"}</button>}</dd>
            <dt>Valor por km</dt><dd>{(() => {
              const f = c.fornecedores;
              if (!f) return <span className="texto-fraco">—</span>;
              if (f.valor_km == null) return <span className="texto-fraco">{f.nome} sem valor por km em Cadastros › Fornecedores</span>;
              const v = valorPorKm(c.distancia_km ?? null, { valor_km: f.valor_km, bandeirada: f.bandeirada ?? null });
              return v != null ? <>{brl(v)}<small className="bloco texto-fraco">{f.bandeirada ? `${brl(f.bandeirada)} + ` : ""}{fmtKm(c.distancia_km)} × {brl(f.valor_km)}</small><DifKm porKm={v} tabela={c.valor_tabela} /></> : <span className="texto-fraco">Falta a distância</span>;
            })()}</dd>
            <dt>Valor da tabela</dt><dd>{c.valor_tabela != null ? <>{brl(c.valor_tabela)}<small className="bloco texto-fraco">{c.preco_descricao}</small></> : <span className="texto-fraco">{!c.fornecedor_id ? "—" : c.preco_calculado_em ? "Este fornecedor não tem valor na tabela para o trecho" : "Ainda não calculado"}</span>}
              {c.fornecedor_id && podeAgir && <button type="button" className="atalho bloco" disabled={ocupado} onClick={() => executar("recalcular_preco")}>Recalcular pela tabela de preços</button>}</dd>
            <dt>Valor informado</dt><dd>{brl(c.valor_informado)}{acimaDaTabela(c) && <small className="bloco acima-tabela">{brl(Number(c.valor_informado) - Number(c.valor_tabela))} acima da tabela</small>}{c.valor_tabela == null && (() => {
              const esperado = valorEsperado(c as any, c.fornecedores ? { ...(c.fornecedores as any), id: c.fornecedor_id } : null);
              return esperado != null ? <small className="bloco texto-fraco">Referência pela tarifa: {brl(esperado)}</small> : null;
            })()}</dd>
            <dt>Valor faturado</dt><dd>{brl(c.valor_faturado)}</dd>
            {c.motivo_cancelamento && <><dt>Cancelamento</dt><dd>{c.motivo_cancelamento}</dd></>}
          </dl>
        </fieldset>

        {["concluida", "validada", "contestada"].includes(c.status) && (
          <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <legend>Extras (pedágio, espera…)</legend>
            <ExtrasCorrida corridaId={c.id} podeAgir={podeAgir} onMudou={onMudou} />
          </fieldset>
        )}

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
