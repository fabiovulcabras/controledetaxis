"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { Campo, GrupoCampo } from "@/components/Formulario";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";
import CampoEndereco, { type LocalCadastrado } from "@/components/CampoEndereco";
import NotificacoesPush from "@/components/NotificacoesPush";

type Dados = {
  nome: string; locais?: LocalCadastrado[];
  motivos: string[]; max_dias: number; retencao_meses?: number;
  frequentes?: { endereco: string; lat: number | null; lng: number | null }[];
  corridas: {
    id: string; protocolo: string; status: string; status_rotulo: string; quando: string; origem: string; destino: string;
    fornecedor: string | null; motorista: string | null; pode_cancelar: boolean; whatsapp_fornecedor: string | null;
    chegou?: string | null; avaliacao?: number | null; pode_avaliar?: boolean;
    repetir?: Record<string, any>;
  }[];
};
type Resultado = { protocolo: string; fornecedor: string | null; whatsapp?: string; envio_automatico?: boolean; aviso?: string };

const vazio = { origem_google: false, destino_google: false, origem_lat: null as number | null, origem_lng: null as number | null, destino_lat: null as number | null, destino_lng: null as number | null, tipo: "imediata", data_hora: "", origem: "", destino: "", qtd_passageiros: "1", outros_passageiros: "", motivo: "", motivo_outro: "", observacoes: "" };
const classeStatus = (s: string) => `tag st-${s}`;
const novaChave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Página pessoal de pedido de táxi, aberta pelo link que a pessoa autorizada recebe no WhatsApp. */
export default function Pedir() {
  const { token } = useParams<{ token: string }>();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroLink, setErroLink] = useState("");
  // Link protegido por código (parâmetro pedido_exige_codigo): pede os 4 números na primeira vez neste aparelho
  const [pedeCodigo, setPedeCodigo] = useState(false);
  const [form, setForm] = useState(vazio);
  // Outros destinos além do principal (até 4). O app escolhe a ordem de menor km e deixa o mais longe como final.
  const [extras, setExtras] = useState<{ texto: string; lat: number | null; lng: number | null; google: boolean }[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivoCancel, setMotivoCancel] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; whatsapp?: string | null } | null>(null);
  // Chave do envio atual: se o mesmo formulário for enviado duas vezes, o servidor devolve o primeiro pedido
  const [chaveEnvio, setChaveEnvio] = useState(novaChave);

  const carregar = async () => {
    const r = await fetch(`/api/pedido?token=${token}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.codigo) { setPedeCodigo(true); return; }
    if (!r.ok) { setErroLink(j.erro ?? "Não foi possível abrir o link."); return; }
    setPedeCodigo(false);
    setDados(j);
  };
  useEffect(() => { void carregar(); }, [token]);
  useIntervaloVisivel(() => void carregar(), 20_000);

  const campo = (k: keyof typeof vazio) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    // Origem digitada à mão deixa de valer como ponto do mapa
    setForm({ ...form, [k]: e.target.value, ...(k === "origem" ? { origem_lat: null, origem_lng: null, origem_google: false } : {}) });
  const [localizando, setLocalizando] = useState(false);
  const [minhaPosicao, setMinhaPosicao] = useState<{ lat: number; lng: number } | null>(null);
  const minhaUnidade = dados?.locais?.find((l) => l.minha) ?? null;
  const perto = minhaPosicao ?? (form.origem_lat != null && form.origem_lng != null ? { lat: form.origem_lat, lng: form.origem_lng } : null);

  const usarLocalizacao = () => {
    setErr("");
    if (!navigator.geolocation) { setErr("Este celular não permite pegar a localização. Digite o endereço."); return; }
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        setMinhaPosicao({ lat, lng });
        const r = await fetch(`/api/endereco?t=${token}&lat=${lat}&lng=${lng}`).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        setLocalizando(false);
        if (!r?.ok || !j.endereco) { setErr(j.erro ?? "Não foi possível descobrir o endereço. Digite a origem."); return; }
        setForm((f) => ({ ...f, origem: j.endereco, origem_lat: lat, origem_lng: lng, origem_google: false }));
      },
      () => { setLocalizando(false); setErr("Não foi possível pegar a localização. Permita o acesso à localização ou digite o endereço."); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const motivo = form.motivo === "outro" ? form.motivo_outro : form.motivo;
    if (form.tipo === "agendada" && !form.data_hora) { setErr("Informe a data e a hora."); return; }
    setEnviando(true);
    const r = await fetch("/api/pedido", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token, chave_envio: chaveEnvio, tipo: form.tipo, data_hora: form.data_hora ? new Date(form.data_hora).toISOString() : null,
        origem: form.origem, origem_lat: form.origem_lat, origem_lng: form.origem_lng, destino: form.destino, destino_lat: form.destino_lat, destino_lng: form.destino_lng, origem_google: form.origem_google, destino_google: form.destino_google, qtd_passageiros: Number(form.qtd_passageiros), outros_passageiros: form.outros_passageiros,
        motivo, observacoes: form.observacoes.trim(),
        destinos_extras: extras.filter((x) => x.texto.trim().length >= 3),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) { setErr(j.erro ?? "Não foi possível registrar o pedido."); return; }
    setResultado(j);
    setChaveEnvio(novaChave());
    setForm(vazio);
    setExtras([]);
    window.scrollTo(0, 0);
    void carregar();
  };

  const cancelar = async (id: string) => {
    setErr("");
    const r = await fetch("/api/pedido/cancelar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, corrida_id: id, motivo: motivoCancel }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.erro ?? "Não foi possível cancelar."); return; }
    setCancelando(null); setMotivoCancel("");
    setAviso({ texto: "Corrida cancelada.", whatsapp: j.whatsapp });
    void carregar();
  };

  if (pedeCodigo) return <Moldura><CodigoAcesso token={token} onLiberado={() => void carregar()} /></Moldura>;
  if (erroLink) return <Moldura><section className="card"><h2>Link indisponível</h2><p className="err">{erroLink}</p></section></Moldura>;
  if (!dados) return <Moldura><p className="empty">Carregando…</p></Moldura>;

  const agora = new Date();
  const minimo = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  return (
    <Moldura subtitulo={dados.nome}>
      <NotificacoesPush tipo="solicitante" token={token} />
      {resultado && (
        <section className="card">
          <span className="texto-fraco">Pedido registrado</span>
          <span className="protocolo-grande">{resultado.protocolo}</span>
          {resultado.aviso ? <p className="err">{resultado.aviso}</p> : resultado.envio_automatico ? (
            <p className="ok">O fornecedor {resultado.fornecedor} já recebeu a solicitação pelo WhatsApp. Você será avisado quando ele responder.</p>
          ) : (
            <>
              <p className="pagina-sub" style={{ margin: "8px 0 14px" }}>Falta um passo: toque abaixo para mandar o pedido ao fornecedor <strong>{resultado.fornecedor}</strong>. O WhatsApp abre com a mensagem pronta; é só tocar em enviar.</p>
              {resultado.whatsapp && <a className="botao-whatsapp" href={resultado.whatsapp} target="_blank" rel="noopener noreferrer">Enviar ao fornecedor pelo WhatsApp</a>}
            </>
          )}
          <div className="row" style={{ marginTop: 12 }}><button type="button" className="ghost" onClick={() => setResultado(null)}>Fazer outro pedido</button></div>
        </section>
      )}

      {aviso && <div className="ok">{aviso.texto}{aviso.whatsapp && <><br /><a className="botao-whatsapp" style={{ marginTop: 8 }} href={aviso.whatsapp} target="_blank" rel="noopener noreferrer">Avisar o fornecedor pelo WhatsApp</a></>}</div>}

      {!resultado && (
        <form className="card" onSubmit={enviar} noValidate>
          <h2>Pedir táxi</h2>
          <p className="pagina-sub" style={{ marginBottom: 14 }}>Preencha e confirme. A corrida recebe um protocolo na hora.</p>
          <div style={{ display: "grid", gap: 14 }}>
            <GrupoCampo rotulo="Quando?" obrigatorio>
              <div className="escolha-dupla">
                <button type="button" className={form.tipo === "imediata" ? "ativo" : ""} aria-pressed={form.tipo === "imediata"} onClick={() => setForm({ ...form, tipo: "imediata" })}>Agora</button>
                <button type="button" className={form.tipo === "agendada" ? "ativo" : ""} aria-pressed={form.tipo === "agendada"} onClick={() => setForm({ ...form, tipo: "agendada" })}>Agendar</button>
              </div>
            </GrupoCampo>
            {form.tipo === "agendada" && <Campo rotulo="Data e hora" obrigatorio><input type="datetime-local" min={minimo} value={form.data_hora} onChange={campo("data_hora")} /></Campo>}
            <GrupoCampo rotulo="Origem" obrigatorio htmlFor="campo-origem">
              <CampoEndereco id="campo-origem" token={token} valor={form.origem} placeholder="Digite rua e número ou o nome de um local" perto={perto} locais={dados.locais}
                onMudar={(origem, lat, lng, google) => setForm((f) => ({ ...f, origem, origem_lat: lat, origem_lng: lng, origem_google: !!google }))} />
              <div className="atalhos">
                {minhaUnidade && <button type="button" className="atalho" onClick={() => setForm({ ...form, origem: minhaUnidade.texto, origem_lat: minhaUnidade.lat, origem_lng: minhaUnidade.lng, origem_google: false })}>Sair da {minhaUnidade.nome}</button>}
                <button type="button" className="atalho" onClick={usarLocalizacao} disabled={localizando}>{localizando ? "Buscando endereço…" : "Usar minha localização"}</button>
              </div>
              {form.origem_lat != null && <span className="campo-ajuda">Confira o número; se precisar, corrija.</span>}
              <Frequentes locais={dados.locais} lista={dados.frequentes} atual={form.origem} onEscolher={(f) => setForm({ ...form, origem: f.endereco, origem_lat: f.lat, origem_lng: f.lng, origem_google: false })} />
            </GrupoCampo>
            <GrupoCampo rotulo="Destino" obrigatorio htmlFor="campo-destino">
              <CampoEndereco id="campo-destino" token={token} valor={form.destino} placeholder="Digite rua e número ou o nome de um local" perto={perto} locais={dados.locais}
                onMudar={(destino, lat, lng, google) => setForm((f) => ({ ...f, destino, destino_lat: lat, destino_lng: lng, destino_google: !!google }))} />
              {minhaUnidade && <div className="atalhos"><button type="button" className="atalho" onClick={() => setForm({ ...form, destino: minhaUnidade.texto, destino_lat: minhaUnidade.lat, destino_lng: minhaUnidade.lng, destino_google: false })}>Ir para a {minhaUnidade.nome}</button></div>}
              <Frequentes locais={dados.locais} lista={dados.frequentes} atual={form.destino} onEscolher={(f) => setForm({ ...form, destino: f.endereco, destino_lat: f.lat, destino_lng: f.lng, destino_google: false })} />
            </GrupoCampo>
            {extras.map((x, i) => (
              <GrupoCampo key={i} rotulo={`Outro destino (${i + 2})`} htmlFor={`campo-destino-${i + 2}`}>
                <div className="linha-destino-extra">
                  <CampoEndereco id={`campo-destino-${i + 2}`} token={token} valor={x.texto} placeholder="Digite rua e número ou o nome de um local" perto={perto} locais={dados.locais}
                    onMudar={(texto, lat, lng, google) => setExtras((l) => l.map((y, k) => (k === i ? { texto, lat, lng, google: !!google } : y)))} />
                  <button type="button" className="ghost" aria-label={`Remover destino ${i + 2}`} onClick={() => setExtras((l) => l.filter((_, k) => k !== i))}>Remover</button>
                </div>
              </GrupoCampo>
            ))}
            {extras.length < 4 && (
              <button type="button" className="atalho" style={{ justifySelf: "start" }} onClick={() => setExtras((l) => [...l, { texto: "", lat: null, lng: null, google: false }])}>+ Adicionar outro destino</button>
            )}
            {extras.length > 0 && <p className="campo-ajuda" style={{ margin: 0 }}>O app organiza as paradas pelo menor trajeto em km. O destino mais longe fica como destino final e define o valor da tabela.</p>}
            <Campo rotulo="Passageiros" obrigatorio>
              <select value={form.qtd_passageiros} onChange={campo("qtd_passageiros")}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? "Só eu" : `${n} pessoas`}</option>)}
              </select>
            </Campo>
            {Number(form.qtd_passageiros) > 1 && <Campo rotulo="Nome dos outros passageiros"><input value={form.outros_passageiros} onChange={campo("outros_passageiros")} /></Campo>}
            <Campo rotulo="Motivo" obrigatorio>
              <select value={form.motivo} onChange={campo("motivo")}>
                <option value="">Escolha</option>
                {dados.motivos.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="outro">Outro motivo</option>
              </select>
            </Campo>
            {form.motivo === "outro" && <Campo rotulo="Qual?" obrigatorio><input value={form.motivo_outro} onChange={campo("motivo_outro")} /></Campo>}
            <Campo rotulo="Observações" ajuda="Opcional. O fornecedor vê junto com a corrida.">
              <textarea rows={3} maxLength={500} value={form.observacoes} onChange={campo("observacoes")} placeholder="Ex.: bagagem grande, ponto de referência, passageiro com mobilidade reduzida" />
            </Campo>
            {err && <div className="err">{err}</div>}
            <button className="pri botao-grande" disabled={enviando}>{enviando ? "Registrando…" : "Confirmar pedido"}</button>
          </div>
        </form>
      )}

      <h3>Minhas corridas</h3>
      {dados.corridas.length ? (
        <div className="minhas-corridas">
          {dados.corridas.map((c) => (
            <article key={c.id} className="minha-corrida">
              <div className="minha-corrida-topo"><span className="protocolo">{c.protocolo}</span><span className={classeStatus(c.status)}>{c.status_rotulo}</span></div>
              <p>{c.quando} · {c.destino}</p>
              <p className="texto-fraco">{c.fornecedor ?? "Sem fornecedor"}{c.motorista ? ` · ${c.motorista}` : ""}</p>
              {c.chegou && c.status === "aceita" && <p className="ok" style={{ margin: "4px 0" }}>O motorista chegou ao local de embarque.</p>}
              {c.avaliacao ? <p className="texto-fraco" style={{ margin: "4px 0" }}>Sua nota: {"★".repeat(c.avaliacao)}{"☆".repeat(5 - c.avaliacao)}</p>
                : c.pode_avaliar && <AvaliarCorrida token={token} corridaId={c.id} onAvaliada={() => void carregar()} />}
              {c.repetir && !resultado && (
                <div className="row"><button type="button" className="ghost" onClick={() => {
                  const r = c.repetir!;
                  setForm({ ...vazio, ...r, qtd_passageiros: String(r.qtd_passageiros ?? 1),
                    motivo: dados.motivos.includes(r.motivo) ? r.motivo : "outro", motivo_outro: dados.motivos.includes(r.motivo) ? "" : r.motivo });
                  setChaveEnvio(novaChave());
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}>Repetir esta corrida</button></div>
              )}
              {c.whatsapp_fornecedor && <a className="botao-whatsapp" style={{ marginTop: 8, minHeight: 42, fontSize: 14 }} href={c.whatsapp_fornecedor} target="_blank" rel="noopener noreferrer">Reenviar ao fornecedor pelo WhatsApp</a>}
              {c.pode_cancelar && (cancelando === c.id ? (
                <form className="row" onSubmit={(e) => { e.preventDefault(); void cancelar(c.id); }}>
                  <input value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="Motivo do cancelamento" autoFocus style={{ flex: 1 }} />
                  <button className="danger" disabled={motivoCancel.trim().length < 3}>Cancelar corrida</button>
                  <button type="button" className="ghost" onClick={() => setCancelando(null)}>Voltar</button>
                </form>
              ) : <div className="row"><button type="button" className="ghost botao-perigo" onClick={() => { setCancelando(c.id); setMotivoCancel(""); }}>Cancelar</button></div>)}
              {c.status === "em_andamento" && <p className="texto-fraco" style={{ fontSize: 13, margin: "6px 0 0" }}>O passageiro já embarcou: a corrida não pode mais ser cancelada.</p>}
            </article>
          ))}
        </div>
      ) : <p className="empty">Nenhuma corrida ainda.</p>}
      <p className="texto-fraco" style={{ fontSize: 12, margin: "18px 4px 8px" }}>
        Privacidade: usamos seu nome, telefone e os endereços só para organizar as corridas da empresa e pagar os fornecedores.
        {dados.retencao_meses ? ` Mensagens e localizações são apagadas depois de ${dados.retencao_meses} meses; o registro da corrida fica para a prestação de contas.` : ""}
        {" "}Dúvidas ou pedido de exclusão: fale com o planejamento.
      </p>
    </Moldura>
  );
}

/** Atalhos com os endereços que a pessoa mais usa. */
function Frequentes({ lista, atual, onEscolher, locais }: {
  locais?: LocalCadastrado[];
  lista?: { endereco: string; lat: number | null; lng: number | null }[]; atual: string; onEscolher: (f: { endereco: string; lat: number | null; lng: number | null }) => void;
}) {
  const opcoes = (lista ?? []).filter((f) => f.endereco !== atual && !(locais ?? []).some((l) => l.texto === f.endereco)).slice(0, 4);
  if (!opcoes.length) return null;
  return (
    <div className="chips-endereco" aria-label="Endereços usados recentemente">
      {opcoes.map((f) => <button key={f.endereco} type="button" title={f.endereco} onClick={() => onEscolher(f)}>{f.endereco.split(",")[0]}</button>)}
    </div>
  );
}

/** Código de 4 números que libera este aparelho para o link de pedido. */
function CodigoAcesso({ token, onLiberado }: { token: string; onLiberado: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(""); setOcupado(true);
    const r = await fetch("/api/pedido/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, codigo }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setOcupado(false);
    if (!r?.ok) { setErro(j.erro ?? "Não foi possível conferir o código."); return; }
    onLiberado();
  };
  return (
    <form className="card" onSubmit={enviar} style={{ maxWidth: 420, margin: "0 auto", display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Digite seu código</h2>
      <p className="pagina-sub" style={{ margin: 0 }}>Na primeira vez neste celular, digite o código de 4 números que veio junto com o seu link.</p>
      <input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} aria-label="Código de 4 números" style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }} autoFocus />
      {erro && <p className="err" style={{ margin: 0 }}>{erro}</p>}
      <button className="pri botao-grande" disabled={ocupado || codigo.length !== 4}>{ocupado ? "Conferindo…" : "Entrar"}</button>
      <p className="texto-fraco" style={{ fontSize: 13, margin: 0 }}>Não tem o código? Peça ao setor de planejamento.</p>
    </form>
  );
}

function Moldura({ subtitulo, children }: { subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="publico">
      <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Pedido de táxi</strong>{subtitulo && <small>{subtitulo}</small>}</div></div></header>
      <main className="publico-corpo">{children}</main>
    </div>
  );
}

/** Nota de 1 a 5 (e comentário opcional) para uma corrida concluída. */
function AvaliarCorrida({ token, corridaId, onAvaliada }: { token: string; corridaId: string; onAvaliada: () => void }) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const enviar = async () => {
    setEnviando(true); setErro("");
    try {
      const r = await fetch("/api/pedido/avaliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, corrida_id: corridaId, nota, comentario }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível registrar a nota."); return; }
      onAvaliada();
    } finally { setEnviando(false); }
  };
  return (
    <div className="avaliar-corrida" style={{ marginTop: 6 }}>
      <span className="texto-fraco" style={{ fontSize: 13 }}>Como foi esta corrida?</span>
      <div className="row" role="radiogroup" aria-label="Nota de 1 a 5" style={{ gap: 2 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={`${n} de 5`} className="ghost"
            style={{ fontSize: 24, padding: "2px 6px", minHeight: 0, color: n <= nota ? "#f5a623" : undefined }} onClick={() => setNota(n)}>{n <= nota ? "★" : "☆"}</button>
        ))}
      </div>
      {nota > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
          <input value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={500} placeholder={nota <= 3 ? "O que não foi bem? (opcional)" : "Comentário (opcional)"} />
          <div className="row"><button type="button" className="pri" disabled={enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar nota"}</button></div>
        </div>
      )}
      {erro && <p className="err">{erro}</p>}
    </div>
  );
}
