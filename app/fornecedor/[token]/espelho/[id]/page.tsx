"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import LoginFornecedor from "@/components/LoginFornecedor";
import { Campo } from "@/components/Formulario";
import { brl, lerValor } from "@/lib/datas";
import { TIPOS_EXTRA, erroArquivo, type TipoExtra } from "@/lib/extras";
import { ORIGEM_BASE, STATUS_ESPELHO, nomeCompetencia, type StatusEspelho } from "@/lib/espelho-status";

type ItemP = {
  id: string; protocolo: string; quando: string; origem: string; destino: string; passageiros: number; solicitante: string; link: string | null;
  valor_informado: number | null; valor_base: number; base_origem: string; valor_extras: number; valor_final: number; ajuste_obs: string | null;
  contestacao_status: "contestado" | "aceita" | "mantida" | null; contestacao_motivo: string | null; contestacao_valor: number | null; contestacao_resposta: string | null;
  extras: { tipo: TipoExtra; descricao: string | null; valor: number; status: string; motivo_recusa: string | null }[];
};
type Dados = {
  fornecedor: string;
  espelho: { id: string; competencia: string; status: StatusEspelho; versao: number; total: number; prazo: string | null; prazo_em: string | null; aprovacao: string | null;
    nf_numero: string | null; nf_valor: number | null; nf_enviada_em: string | null; pago_em: string | null };
  itens: ItemP[];
  eventos: { origem: string; tipo: string; descricao: string | null; quando: string }[];
};

/** Espelho do mês no portal do fornecedor: conferir, aprovar ou contestar itens e, depois, enviar a NF. */
export default function EspelhoFornecedor() {
  const { token, id } = useParams<{ token: string; id: string }>();
  const [d, setD] = useState<Dados | null>(null);
  const [login, setLogin] = useState(false);
  const [erro, setErro] = useState("");
  const [contestar, setContestar] = useState<Record<string, { motivo: string; valor: string }>>({});
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [nf, setNf] = useState({ numero: "", valor: "" });
  const [pdf, setPdf] = useState<File | null>(null);

  const carregar = async () => {
    const r = await fetch(`/api/portal/espelhos?token=${token}&id=${id}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.login) { setLogin(true); return; }
    if (!r.ok) { setErro(j.erro ?? "Não foi possível abrir o espelho."); return; }
    setLogin(false); setD(j);
  };
  useEffect(() => { void carregar(); }, [token, id]);

  const enviar = async (acao: "aprovar" | "contestar") => {
    setOcupado(true); setErr(""); setOk("");
    const itens = Object.entries(contestar).map(([iid, v]) => ({ id: iid, motivo: v.motivo, valor: v.valor }));
    try {
      const r = await fetch("/api/portal/espelhos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, id, acao, itens }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.erro ?? "Não foi possível registrar."); return; }
      setContestar({});
      setOk(acao === "aprovar" ? "Espelho aprovado. Agora envie a NF com o valor total." : "Contestação enviada. O planejamento vai analisar e reenviar o espelho.");
      await carregar(); window.scrollTo(0, 0);
    } finally { setOcupado(false); }
  };
  const enviarNf = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setOk("");
    const p = erroArquivo(pdf, true);
    if (p) { setErr(p); return; }
    const fd = new FormData();
    fd.set("token", token); fd.set("id", id); fd.set("numero", nf.numero); fd.set("valor", nf.valor); fd.set("arquivo", pdf as File);
    setOcupado(true);
    try {
      const r = await fetch("/api/portal/espelhos/nf", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.erro ?? (r.status === 413 ? "O PDF é grande demais (máximo 4 MB)." : "Não foi possível enviar a NF.")); return; }
      setOk(j.diferente ? "NF enviada. Atenção: o valor é diferente do espelho; o planejamento vai conferir." : "NF enviada. Obrigado!");
      setPdf(null); await carregar(); window.scrollTo(0, 0);
    } finally { setOcupado(false); }
  };

  const topo = (
    <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Espelho do mês</strong>{d && <small>{d.fornecedor}</small>}</div>
      <Link href={`/fornecedor/${token}`} className="ghost" style={{ marginLeft: "auto" }}>Portal</Link></div></header>
  );
  if (login) return <div className="publico">{topo}<main className="publico-corpo"><LoginFornecedor token={token} onEntrou={() => void carregar()} /></main></div>;
  if (erro) return <div className="publico">{topo}<main className="publico-corpo"><section className="card"><p className="err">{erro}</p></section></main></div>;
  if (!d) return <div className="publico">{topo}<main className="publico-corpo"><p className="empty">Carregando…</p></main></div>;

  const e = d.espelho;
  const aguardando = e.status === "aguardando";
  const nContest = Object.keys(contestar).length;
  const contestOk = nContest > 0 && Object.values(contestar).every((v) => v.motivo.trim() && v.valor.trim());
  const problemaPdf = pdf ? erroArquivo(pdf, true) : null;

  return (
    <div className="publico">
      {topo}
      <main className="publico-corpo">
        {ok && <div className="ok">{ok}</div>}
        {err && <div className="err">{err}</div>}
        <section className="card">
          <div className="minha-corrida-topo"><strong style={{ fontSize: 18 }}>Competência {nomeCompetencia(e.competencia)}{e.versao > 1 ? ` · versão ${e.versao}` : ""}</strong><span className={`tag ${STATUS_ESPELHO[e.status].tag}`}>{STATUS_ESPELHO[e.status].portal}</span></div>
          <p style={{ fontSize: 28, margin: "8px 0", color: "var(--navy)" }}><strong>{brl(e.total)}</strong> <small className="texto-fraco" style={{ fontSize: 14 }}>{d.itens.length} corrida(s)</small></p>
          {aguardando && <p className="pagina-sub" style={{ margin: 0 }}>Confira as corridas e <strong>aprove</strong> ou <strong>conteste</strong> os itens com problema até <strong>{e.prazo}</strong>. Sem resposta até lá, o espelho é aprovado automaticamente.</p>}
          {e.status === "contestado" && <p className="pagina-sub" style={{ margin: 0 }}>Sua contestação está com o planejamento. Você recebe o espelho de novo quando ela for analisada.</p>}
          {e.status === "aprovado" && <p className="pagina-sub" style={{ margin: 0 }}>Espelho aprovado{e.aprovacao === "tacita" ? " automaticamente (sem resposta no prazo)" : ""}. Emita a NF de <strong>{brl(e.total)}</strong> e envie abaixo.</p>}
          {e.status === "nf_enviada" && <p className="pagina-sub" style={{ margin: 0 }}>NF {e.nf_numero} de {brl(e.nf_valor)} recebida. Aguardando pagamento.</p>}
          {e.status === "pago" && <p className="pagina-sub" style={{ margin: 0 }}>Pago em {e.pago_em?.split("-").reverse().join("/")}.</p>}
          <p className="texto-fraco" style={{ fontSize: 13, marginBottom: 0 }}>Cada corrida entra pelo valor da tabela combinada; sem preço na tabela, pelo valor que você informou. Extras: só os aprovados.</p>
        </section>

        {(e.status === "aprovado" || e.status === "nf_enviada") && (
          <form className="card" onSubmit={enviarNf}>
            <h3 style={{ marginTop: 0 }}>{e.status === "nf_enviada" ? "Reenviar NF" : "Enviar NF"}</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <Campo rotulo="Número da NF" obrigatorio><input value={nf.numero} onChange={(x) => setNf({ ...nf, numero: x.target.value })} maxLength={30} required /></Campo>
              <Campo rotulo="Valor da NF (R$)" obrigatorio aviso={nf.valor && Math.abs((lerValor(nf.valor) ?? 0) - e.total) >= 0.01 ? `Diferente do espelho (${brl(e.total)}).` : undefined}>
                <input inputMode="decimal" value={nf.valor} onChange={(x) => setNf({ ...nf, valor: x.target.value })} placeholder={String(e.total.toFixed(2)).replace(".", ",")} required />
              </Campo>
              <Campo rotulo="PDF da NF (até 4 MB)" obrigatorio aviso={problemaPdf ?? undefined}><input type="file" accept="application/pdf" onChange={(x) => setPdf(x.target.files?.[0] ?? null)} required /></Campo>
              <button className="pri botao-grande" disabled={ocupado || !nf.numero.trim() || !nf.valor.trim() || !pdf || !!problemaPdf}>{ocupado ? "Enviando…" : "Enviar NF"}</button>
            </div>
          </form>
        )}

        <h3>Corridas</h3>
        <div className="minhas-corridas">
          {d.itens.map((i) => {
            const c = contestar[i.id];
            return (
              <div key={i.id} className="minha-corrida" style={{ borderColor: c ? "var(--red-600)" : i.contestacao_status === "contestado" ? "var(--gold)" : undefined }}>
                <div className="minha-corrida-topo">
                  {i.link ? <Link href={i.link} className="protocolo">{i.protocolo}</Link> : <span className="protocolo">{i.protocolo}</span>}
                  <strong>{brl(i.valor_final)}</strong>
                </div>
                <p>{i.quando} · {i.solicitante}</p>
                <p className="texto-fraco">{i.origem} → {i.destino}</p>
                <p className="texto-fraco" style={{ fontSize: 13 }}>
                  {ORIGEM_BASE[i.base_origem]}: {brl(i.valor_base)}
                  {i.valor_informado != null && i.base_origem === "tabela" && Math.abs(i.valor_informado - i.valor_base) >= 0.01 ? ` (você informou ${brl(i.valor_informado)})` : ""}
                  {i.valor_extras ? ` + extras ${brl(i.valor_extras)}` : ""}
                </p>
                {i.extras.length > 0 && <ul className="lista-extras" style={{ margin: "4px 0" }}>{i.extras.map((x, k) => (
                  <li key={k} style={{ padding: "6px 10px" }}><span>{TIPOS_EXTRA[x.tipo]} · {brl(x.valor)}</span><span className={`tag ${x.status === "aprovado" ? "aprovada" : "reprovada"}`}>{x.status === "aprovado" ? "Aprovado" : `Recusado${x.motivo_recusa ? `: ${x.motivo_recusa}` : ""}`}</span></li>
                ))}</ul>}
                {i.ajuste_obs && <p className="texto-fraco" style={{ fontSize: 13 }}>Ajuste do planejamento: {i.ajuste_obs}</p>}
                {i.contestacao_status && (
                  <p style={{ fontSize: 13 }}>Você contestou: pediu {brl(i.contestacao_valor)} ({i.contestacao_motivo}).{" "}
                    {i.contestacao_status === "contestado" ? <span className="tag pendente">Em análise</span> : i.contestacao_status === "aceita" ? <span className="tag aprovada">Aceita</span> : <span className="tag reprovada">Valor mantido{i.contestacao_resposta ? `: ${i.contestacao_resposta}` : ""}</span>}
                  </p>
                )}
                {aguardando && (c ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                    <Campo rotulo="Valor que você entende correto (R$)" obrigatorio><input inputMode="decimal" value={c.valor} onChange={(x) => setContestar({ ...contestar, [i.id]: { ...c, valor: x.target.value } })} autoFocus /></Campo>
                    <Campo rotulo="Motivo" obrigatorio><input value={c.motivo} onChange={(x) => setContestar({ ...contestar, [i.id]: { ...c, motivo: x.target.value } })} maxLength={500} placeholder="Ex.: pedágio de R$ 12,40 não incluído" /></Campo>
                    <button type="button" className="ghost" onClick={() => { const n = { ...contestar }; delete n[i.id]; setContestar(n); }}>Desfazer contestação</button>
                  </div>
                ) : <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={() => setContestar({ ...contestar, [i.id]: { motivo: "", valor: "" } })}>Contestar este item</button>)}
              </div>
            );
          })}
        </div>

        {aguardando && (
          <section className="card" style={{ position: "sticky", bottom: 8, marginTop: 16, display: "grid", gap: 8 }}>
            {nContest ? <>
              <button type="button" className="danger botao-grande" disabled={ocupado || !contestOk} onClick={() => enviar("contestar")}>{ocupado ? "Enviando…" : `Enviar contestação de ${nContest} item(ns)`}</button>
              {!contestOk && <small className="texto-fraco">Preencha valor e motivo de cada item contestado.</small>}
            </> : <button type="button" className="pri botao-grande" disabled={ocupado} onClick={() => enviar("aprovar")}>{ocupado ? "Registrando…" : `Aprovar espelho de ${brl(e.total)}`}</button>}
          </section>
        )}

        <h3 style={{ marginTop: 20 }}>Histórico</h3>
        <ul className="lista-extras">
          {d.eventos.slice().reverse().map((ev, k) => <li key={k}><span>{ev.descricao}</span><small className="texto-fraco">{ev.quando}</small></li>)}
        </ul>
      </main>
    </div>
  );
}
