"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { TopoPagina } from "@/components/Formulario";
import { formatarHora } from "@/lib/datas";
import { formatarTelefone, normalizarTelefone } from "@/lib/telefone";

type Mensagem = { id: string; direcao: "entrada" | "saida"; telefone: string; template: string | null; conteudo: any; criado_em: string };
type Pessoa = { id: string; nome: string; telefone_whatsapp: string };

export default function Simulador() {
  const [solicitantes, setSolicitantes] = useState<Pessoa[]>([]);
  const [fornecedores, setFornecedores] = useState<Pessoa[]>([]);
  const [telSol, setTelSol] = useState("");
  const [outroNumero, setOutroNumero] = useState("");
  const [telForn, setTelForn] = useState("");
  const [telPlan, setTelPlan] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [err, setErr] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      const [s, f, p] = await Promise.all([
        supabase.from("solicitantes").select("id,nome,telefone_whatsapp").eq("ativo", true).order("nome"),
        supabase.from("fornecedores").select("id,nome,telefone_whatsapp").eq("ativo", true).order("prioridade"),
        supabase.from("parametros").select("valor").eq("chave", "planejamento_telefones").maybeSingle(),
      ]);
      setSolicitantes(s.data ?? []); setFornecedores(f.data ?? []);
      setTelSol(s.data?.[0]?.telefone_whatsapp ?? "outro");
      setTelForn(f.data?.[0]?.telefone_whatsapp ?? "");
      setTelPlan(String(p.data?.valor ?? "").split(/[,;\s]+/).filter(Boolean)[0] ?? "");
    })();
  }, []);

  const solicitante = telSol === "outro" ? normalizarTelefone(outroNumero) : telSol;
  const telefones = [solicitante, telForn, telPlan].filter((t) => t && t.length >= 12);

  const carregar = async () => {
    if (!telefones.length) return;
    const { data, error } = await supabase.from("mensagens").select("id,direcao,telefone,template,conteudo,criado_em")
      .eq("canal", "simulado").in("telefone", telefones).order("criado_em", { ascending: true }).limit(400);
    if (error) setErr(error.message);
    setMensagens((data ?? []) as Mensagem[]);
  };
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 1500);
    return () => clearInterval(t);
  }, [telefones.join(",")]);

  const enviar = async (telefone: string, msg: { texto?: string; botaoId?: string; localizacao?: unknown }) => {
    setErr(""); setEnviando(true);
    try { await chamarApi("/api/simulador", { telefone, ...msg }); await carregar(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha ao simular."); }
    finally { setEnviando(false); }
  };
  const limpar = async () => {
    if (!window.confirm("Apagar as mensagens simuladas e as conversas em andamento destes números? As corridas já criadas continuam no painel.")) return;
    await chamarApi("/api/simulador", { telefones }, "DELETE").catch((e) => setErr(e.message));
    await carregar();
  };

  const nomeSol = solicitantes.find((s) => s.telefone_whatsapp === telSol)?.nome ?? "Número não cadastrado";
  const nomeForn = fornecedores.find((f) => f.telefone_whatsapp === telForn)?.nome ?? "Fornecedor";

  return (
    <>
      <TopoPagina titulo="Simulador do bot" subtitulo="Converse como a pessoa autorizada e responda como o fornecedor. É o mesmo motor que atende o WhatsApp de verdade.">
        <button type="button" className="ghost" onClick={limpar}>Limpar conversas</button>
      </TopoPagina>
      <p className="resumo-entrada" style={{ marginBottom: 16 }}>
        As corridas criadas aqui <strong>são gravadas no banco</strong> e aparecem no painel. As mensagens não saem pelo WhatsApp: ficam marcadas como simuladas.
        Mensagens em <strong>modelo</strong> são as que precisam de template aprovado na Meta.
      </p>
      {err && <div className="err">{err}</div>}

      <div className="simulador-barra">
        <label>Pessoa autorizada
          <select value={telSol} onChange={(e) => setTelSol(e.target.value)}>
            {solicitantes.map((s) => <option key={s.id} value={s.telefone_whatsapp}>{s.nome}</option>)}
            <option value="outro">Outro número (não cadastrado)</option>
          </select>
        </label>
        {telSol === "outro" && <label>Número<input value={outroNumero} onChange={(e) => setOutroNumero(e.target.value)} placeholder="(21) 98000-7766" /></label>}
        <label>Fornecedor
          <select value={telForn} onChange={(e) => setTelForn(e.target.value)}>
            {fornecedores.map((f) => <option key={f.id} value={f.telefone_whatsapp}>{f.nome}</option>)}
          </select>
        </label>
        <span className="texto-fraco">{telPlan ? `Planejamento: ${formatarTelefone(telPlan)}` : "Cadastre o número do planejamento em Cadastros › Parâmetros para ver os avisos."}</span>
      </div>

      <div className="telefones">
        <Telefone titulo={nomeSol} subtitulo={solicitante ? formatarTelefone(solicitante) : "Informe o número"} sigla="SO"
          mensagens={mensagens.filter((m) => m.telefone === solicitante)} podeEscrever={!!solicitante && solicitante.length >= 12} ocupado={enviando}
          botoesSoNaUltima onEnviar={(m) => enviar(solicitante, m)} localizacao />
        <Telefone titulo={nomeForn} subtitulo={telForn ? formatarTelefone(telForn) : "Cadastre um fornecedor"} sigla="FO"
          mensagens={mensagens.filter((m) => m.telefone === telForn)} podeEscrever={!!telForn} ocupado={enviando} onEnviar={(m) => enviar(telForn, m)} />
        <Telefone titulo="Planejamento" subtitulo={telPlan ? formatarTelefone(telPlan) : "Sem número cadastrado"} sigla="PL"
          mensagens={mensagens.filter((m) => m.telefone === telPlan)} podeEscrever={!!telPlan} ocupado={enviando} onEnviar={(m) => enviar(telPlan, m)} />
      </div>
    </>
  );
}

function Telefone({ titulo, subtitulo, sigla, mensagens, podeEscrever, ocupado, onEnviar, botoesSoNaUltima, localizacao }: {
  titulo: string; subtitulo: string; sigla: string; mensagens: Mensagem[]; podeEscrever: boolean; ocupado: boolean;
  onEnviar: (m: { texto?: string; botaoId?: string; localizacao?: unknown }) => void; botoesSoNaUltima?: boolean; localizacao?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [usados, setUsados] = useState<Set<string>>(new Set());
  const chat = useRef<HTMLDivElement>(null);
  const ultimoId = mensagens.at(-1)?.id;
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight }); }, [ultimoId]);
  const ultimaSaida = [...mensagens].reverse().find((m) => m.direcao === "saida")?.id;
  const respondeuDepois = (i: number) => mensagens.slice(i + 1).some((m) => m.direcao === "entrada");

  return (
    <section className="telefone" aria-label={titulo}>
      <div className="telefone-topo"><span className="avatar">{sigla}</span><div><strong>{titulo}</strong><small>{subtitulo}</small></div></div>
      <div className="chat" ref={chat}>
        {!mensagens.length && <span className="chat-vazio">{podeEscrever ? "Envie uma mensagem para começar" : "Nenhuma mensagem"}</span>}
        {mensagens.map((m, i) => {
          const opcoes: { id: string; titulo: string; descricao?: string }[] = m.direcao === "saida" ? m.conteudo?.opcoes ?? [] : [];
          const ativo = !usados.has(m.id) && (botoesSoNaUltima ? m.id === ultimaSaida && !respondeuDepois(i) : true);
          const textoEntrada = m.conteudo?.texto || (m.conteudo?.botaoId ? `[${m.conteudo.botaoId}]` : m.conteudo?.localizacao ? "[localização]" : "");
          return (
            <div key={m.id} style={{ display: "contents" }}>
              <div className={`bolha ${m.direcao === "entrada" ? "entrada" : "saida"}`}>
                {m.template && <span className="modelo">Modelo · {m.template}</span>}
                {m.direcao === "entrada" ? textoEntrada : m.conteudo?.texto}
                <span className="hora">{formatarHora(m.criado_em)}</span>
              </div>
              {opcoes.length > 0 && (
                <div className="respostas">
                  {m.conteudo?.rotuloLista && <span className="texto-fraco" style={{ fontSize: 12 }}>{m.conteudo.rotuloLista}:</span>}
                  {opcoes.map((o) => (
                    <button key={o.id} type="button" disabled={!ativo || ocupado} onClick={() => { setUsados(new Set(usados).add(m.id)); onEnviar({ botaoId: o.id }); }}>
                      {o.titulo}{o.descricao && <small>{o.descricao}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form className="compor" onSubmit={(e) => { e.preventDefault(); if (!texto.trim()) return; onEnviar({ texto: texto.trim() }); setTexto(""); }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem" disabled={!podeEscrever} aria-label={`Mensagem como ${titulo}`} />
        <button className="pri" disabled={!podeEscrever || ocupado || !texto.trim()}>Enviar</button>
      </form>
      {localizacao && podeEscrever && (
        <button type="button" className="ghost" style={{ marginTop: 6 }} disabled={ocupado}
          onClick={() => onEnviar({ localizacao: { lat: -23.5614, lng: -46.6559, endereco: "Av. Paulista, 1578 - Bela Vista, São Paulo" } })}>
          Enviar localização de exemplo
        </button>
      )}
    </section>
  );
}
