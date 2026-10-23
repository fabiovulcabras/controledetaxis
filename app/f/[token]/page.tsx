"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { Campo } from "@/components/Formulario";
import { brl } from "@/lib/datas";

type Corrida = {
  protocolo: string; status: string; status_rotulo: string; fornecedor: string | null; quando: string; tipo: string;
  origem: string; destino: string; passageiros: number; outros_passageiros: string | null; solicitante: string; prazo: string | null;
  motorista: string | null; placa: string | null; minutos: number | null; valor: number | null; motivo_cancelamento: string | null; mapa_origem: string;
};
type Link = { rotulo: string; url: string };
type Tela = null | "aceitar" | "recusar" | "valor" | "nao_realizada";

/** Página do fornecedor, aberta pelo link que chega no WhatsApp com cada corrida. */
export default function RespostaFornecedor() {
  const { token } = useParams<{ token: string }>();
  const [c, setC] = useState<Corrida | null>(null);
  const [erroLink, setErroLink] = useState("");
  const [tela, setTela] = useState<Tela>(null);
  const [form, setForm] = useState({ motorista: "", placa: "", minutos: "", motivo: "", valor: "" });
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [links, setLinks] = useState<Link[]>([]);

  const carregar = async () => {
    const r = await fetch(`/api/fornecedor?token=${token}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErroLink(j.erro ?? "Não foi possível abrir a corrida."); return; }
    setC(j);
  };
  useEffect(() => { void carregar(); }, [token]);

  const agir = async (acao: string, extra: Record<string, unknown> = {}, sucesso = "Registrado.") => {
    setOcupado(true); setErr(""); setOk("");
    const r = await fetch("/api/fornecedor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, acao, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { setErr(j.erro ?? "Não foi possível registrar."); await carregar(); return; }
    setOk(sucesso); setLinks(j.links ?? []); setTela(null);
    await carregar();
    window.scrollTo(0, 0);
  };
  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (erroLink) return <Moldura><section className="card"><h2>Link indisponível</h2><p className="err">{erroLink}</p></section></Moldura>;
  if (!c) return <Moldura><p className="empty">Carregando…</p></Moldura>;

  const aguardando = ["enviada", "sem_resposta"].includes(c.status);
  const emCurso = ["aceita", "em_andamento"].includes(c.status);

  return (
    <Moldura subtitulo={c.fornecedor ?? undefined}>
      {ok && <div className="ok">{ok}</div>}
      {links.length > 0 && (
        <section className="card">
          <p className="pagina-sub" style={{ marginTop: 0 }}>Toque para avisar pelo WhatsApp (a mensagem já vai pronta):</p>
          {links.map((l) => <a key={l.url} className="botao-whatsapp" href={l.url} target="_blank" rel="noopener noreferrer">{l.rotulo}</a>)}
        </section>
      )}
      {err && <div className="err">{err}</div>}

      <section className="card">
        <div className="minha-corrida-topo"><span className="protocolo-grande" style={{ margin: 0 }}>{c.protocolo}</span><span className={`tag st-${c.status}`}>{c.status_rotulo}</span></div>
        <dl className="dl" style={{ marginTop: 10 }}>
          <dt>Quando</dt><dd>{c.quando}</dd>
          <dt>Origem</dt><dd>{c.origem}<br /><a className="atalho" href={c.mapa_origem} target="_blank" rel="noopener noreferrer">Ver no mapa</a></dd>
          <dt>Destino</dt><dd>{c.destino}</dd>
          <dt>Passageiros</dt><dd>{c.passageiros}{c.outros_passageiros ? ` · ${c.outros_passageiros}` : ""}</dd>
          <dt>Solicitante</dt><dd>{c.solicitante}</dd>
          {c.prazo && <><dt>Responder até</dt><dd><strong>{c.prazo}</strong></dd></>}
          {c.motorista && <><dt>Motorista</dt><dd>{[c.motorista, c.placa, c.minutos ? `${c.minutos} min` : null].filter(Boolean).join(" · ")}</dd></>}
          {c.valor != null && <><dt>Valor informado</dt><dd>{brl(c.valor)}</dd></>}
          {c.motivo_cancelamento && <><dt>Cancelamento</dt><dd>{c.motivo_cancelamento}</dd></>}
        </dl>
      </section>

      {aguardando && !tela && (
        <div className="escolha-dupla">
          <button type="button" className="ativo" onClick={() => setTela("aceitar")}>Aceitar</button>
          <button type="button" onClick={() => setTela("recusar")}>Recusar</button>
        </div>
      )}

      {tela === "aceitar" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void agir("aceitar", { motorista: form.motorista, placa: form.placa, minutos: Number(form.minutos) }, "Corrida aceita."); }}>
          <h3 style={{ marginTop: 0 }}>Quem vai atender?</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <Campo rotulo="Motorista" obrigatorio><input value={form.motorista} onChange={campo("motorista")} autoFocus /></Campo>
            <Campo rotulo="Placa"><input value={form.placa} onChange={campo("placa")} placeholder="ABC1D23" autoCapitalize="characters" /></Campo>
            <Campo rotulo="Chega em quantos minutos?"><input inputMode="numeric" value={form.minutos} onChange={campo("minutos")} /></Campo>
            <button className="pri botao-grande" disabled={ocupado || form.motorista.trim().length < 2}>{ocupado ? "Registrando…" : "Confirmar aceite"}</button>
            <button type="button" className="ghost" onClick={() => setTela(null)}>Voltar</button>
          </div>
        </form>
      )}

      {tela === "recusar" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void agir("recusar", { motivo: form.motivo }, "Recusa registrada. Obrigado por avisar."); }}>
          <h3 style={{ marginTop: 0 }}>Recusar a corrida</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <Campo rotulo="Motivo (opcional)"><input value={form.motivo} onChange={campo("motivo")} placeholder="Sem carro disponível" /></Campo>
            <button className="danger botao-grande" disabled={ocupado}>{ocupado ? "Registrando…" : "Confirmar recusa"}</button>
            <button type="button" className="ghost" onClick={() => setTela(null)}>Voltar</button>
          </div>
        </form>
      )}

      {emCurso && !tela && (
        <div style={{ display: "grid", gap: 8 }}>
          {c.status === "aceita" && <button type="button" className="pri botao-grande" disabled={ocupado} onClick={() => agir("embarque", {}, "Embarque registrado.")}>Passageiro embarcou</button>}
          <button type="button" className={c.status === "aceita" ? "ghost botao-grande" : "pri botao-grande"} onClick={() => setTela("valor")}>Concluir e informar valor</button>
          <button type="button" className="ghost botao-perigo" onClick={() => setTela("nao_realizada")}>A corrida não foi realizada</button>
        </div>
      )}

      {tela === "valor" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void agir("concluir", { valor: form.valor }, "Corrida concluída. Obrigado!"); }}>
          <h3 style={{ marginTop: 0 }}>Valor da corrida</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <Campo rotulo="Valor (R$)" obrigatorio ajuda="O valor precisa ser o mesmo da fatura; o planejamento confere pelo protocolo."><input inputMode="decimal" value={form.valor} onChange={campo("valor")} placeholder="68,50" autoFocus /></Campo>
            <button className="pri botao-grande" disabled={ocupado || !form.valor.trim()}>{ocupado ? "Registrando…" : "Concluir corrida"}</button>
            <button type="button" className="ghost" onClick={() => setTela(null)}>Voltar</button>
          </div>
        </form>
      )}

      {tela === "nao_realizada" && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Confirmar que a corrida não aconteceu?</h3>
          <p className="pagina-sub">Ela será cancelada e o planejamento verá no painel.</p>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <button type="button" className="danger botao-grande" disabled={ocupado} onClick={() => agir("nao_realizada", {}, "Registrado como não realizada.")}>Sim, não foi realizada</button>
            <button type="button" className="ghost" onClick={() => setTela(null)}>Voltar</button>
          </div>
        </section>
      )}

      {c.status === "cancelada" && <p className="empty">Esta corrida foi cancelada. Não é preciso fazer nada.</p>}
      {["concluida", "validada", "contestada"].includes(c.status) && <p className="empty">Corrida concluída. O valor será conferido com a fatura pelo protocolo {c.protocolo}.</p>}
    </Moldura>
  );
}

function Moldura({ subtitulo, children }: { subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="publico">
      <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Corrida de táxi</strong>{subtitulo && <small>{subtitulo}</small>}</div></div></header>
      <main className="publico-corpo">{children}</main>
    </div>
  );
}
