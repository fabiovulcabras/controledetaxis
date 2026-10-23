"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import Crud from "@/components/Crud";
import { Campo, PainelLateral, TopoPagina } from "@/components/Formulario";
import { useApp } from "@/components/AuthGate";
import { formatarTelefone } from "@/lib/telefone";
import { linkWhatsApp, msgLinkPedido } from "@/lib/whatsapp/link";

type Aba = "solicitantes" | "fornecedores" | "centros" | "unidades" | "parametros" | "usuarios";
const ABAS: [Aba, string][] = [
  ["solicitantes", "Pessoas autorizadas"], ["fornecedores", "Fornecedores"], ["centros", "Centros de custo"],
  ["unidades", "Unidades"], ["parametros", "Parâmetros"], ["usuarios", "Usuários do painel"],
];

export default function Cadastros() {
  const [aba, setAba] = useState<Aba>("solicitantes");
  useEffect(() => {
    const h = window.location.hash.slice(1) as Aba;
    if (ABAS.some(([a]) => a === h)) setAba(h);
  }, []);
  const trocar = (a: Aba) => { setAba(a); window.history.replaceState(null, "", `#${a}`); };

  return (
    <>
      <nav className="abas" aria-label="Cadastros">
        {ABAS.map(([a, rotulo]) => <button key={a} type="button" className={aba === a ? "ativa" : ""} onClick={() => trocar(a)}>{rotulo}</button>)}
      </nav>

      {aba === "solicitantes" && <Crud key="sol" table="solicitantes" title="Pessoas autorizadas" nomeItem="solicitante" ordem="nome"
        subtitulo="Só estas pessoas pedem táxi. Cada uma tem um link pessoal de pedido: use “Link de pedido” para enviar pelo WhatsApp."
        acoesExtras={(r, recarregar) => r.ativo ? <LinkPedido pessoa={r} recarregar={recarregar} /> : null}
        fields={[
          { key: "nome", label: "Nome", required: true },
          { key: "telefone_whatsapp", label: "WhatsApp", required: true, mascara: "whatsapp", unico: true, placeholder: "(11) 98812-4471", ajuda: "O número que a pessoa usa no WhatsApp, com DDD." },
          { key: "setor", label: "Setor" },
          { key: "matricula", label: "Matrícula", esconderNaTabela: true },
          { key: "email", label: "E-mail", type: "email", esconderNaTabela: true },
          { key: "unidade_id", label: "Unidade", type: "select", opcoes: { tabela: "unidades", rotulo: (r) => r.nome } },
          { key: "centro_custo_padrao_id", label: "Centro de custo padrão", type: "select", opcoes: { tabela: "centros_custo", rotulo: (r) => `${r.codigo} · ${r.descricao}` } },
          { key: "fornecedor_padrao_id", label: "Fornecedor padrão", type: "select", opcoes: { tabela: "fornecedores", rotulo: (r) => r.nome }, ajuda: "Vazio: usa o fornecedor ativo de maior prioridade." },
        ]} />}

      {aba === "fornecedores" && <Crud key="forn" table="fornecedores" title="Fornecedores" nomeItem="fornecedor" ordem="prioridade"
        subtitulo="Recebem as corridas pelo WhatsApp com os botões Aceitar e Recusar."
        fields={[
          { key: "nome", label: "Nome", required: true },
          { key: "telefone_whatsapp", label: "WhatsApp que recebe as corridas", required: true, mascara: "whatsapp", unico: true, placeholder: "(11) 3333-4444" },
          { key: "cnpj", label: "CNPJ", mascara: "cnpj" },
          { key: "prioridade", label: "Prioridade", type: "number", required: true, ajuda: "1 = primeira opção quando o solicitante não tem fornecedor padrão." },
          { key: "prazo_resposta_min", label: "Prazo para responder (min)", type: "number", required: true, ajuda: "Corridas imediatas. Agendadas usam o parâmetro prazo_agendada_min." },
        ]} />}

      {aba === "centros" && <Crud key="cc" table="centros_custo" title="Centros de custo" nomeItem="centro de custo" ordem="codigo"
        fields={[
          { key: "codigo", label: "Código", required: true, unico: true, placeholder: "CC 4100" },
          { key: "descricao", label: "Descrição", required: true },
          { key: "unidade_id", label: "Unidade", type: "select", opcoes: { tabela: "unidades", rotulo: (r) => r.nome }, ajuda: "Vazio: aparece para todas as unidades." },
          { key: "teto_por_corrida", label: "Teto por corrida (R$)", type: "number", ajuda: "Valor acima disso gera alerta ao planejamento." },
        ]} />}

      {aba === "unidades" && <Crud key="uni" table="unidades" title="Unidades" nomeItem="unidade" ordem="nome"
        fields={[
          { key: "nome", label: "Nome", required: true, unico: true },
          { key: "endereco_padrao", label: "Endereço", largo: true, ajuda: "O bot oferece este endereço como atalho de origem e destino." },
        ]} />}

      {aba === "parametros" && <Parametros />}
      {aba === "usuarios" && <Usuarios />}
    </>
  );
}

/** Envia ao solicitante o link pessoal de pedido, copia ou troca o link (o antigo deixa de valer). */
function LinkPedido({ pessoa, recarregar }: { pessoa: { id: string; nome: string; telefone_whatsapp: string; token_pedido?: string | null }; recarregar: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [msg, setMsg] = useState("");
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${base}/pedir/${pessoa.token_pedido}`;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setMsg("Link copiado."); } catch { setMsg("Não foi possível copiar; selecione o link e copie."); }
  };
  const trocar = async () => {
    if (!window.confirm(`Gerar um novo link para ${pessoa.nome}? O link atual para de funcionar na hora.`)) return;
    const novo = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const { error } = await supabase.from("solicitantes").update({ token_pedido: novo }).eq("id", pessoa.id);
    setMsg(error ? error.message : "Novo link gerado. Envie para a pessoa.");
    await recarregar();
  };
  return (
    <>
      <button type="button" className="ghost" onClick={() => setAberto(true)}>Link de pedido</button>
      {aberto && (
        <PainelLateral titulo="Link de pedido" subtitulo={pessoa.nome} onFechar={() => setAberto(false)} largura={520}>
          <div className="painel-corpo">
            {!pessoa.token_pedido ? (
              <p className="err">O banco ainda não tem os links de pedido. No Supabase, abra o SQL Editor, rode o arquivo <strong>supabase/002_links_whatsapp.sql</strong> do repositório e recarregue esta página.</p>
            ) : (
            <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
              <legend>Link pessoal</legend>
              <p className="secao-ajuda">É por este link que {pessoa.nome.split(" ")[0]} pede táxi. Os pedidos saem no nome dela; quem tiver o link consegue pedir.</p>
              <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link de pedido" />
              <a className="botao-whatsapp" href={linkWhatsApp(pessoa.telefone_whatsapp, msgLinkPedido(pessoa.nome, base, pessoa.token_pedido))} target="_blank" rel="noopener noreferrer">Enviar para {formatarTelefone(pessoa.telefone_whatsapp)} pelo WhatsApp</a>
              <div className="row">
                <button type="button" className="ghost" onClick={copiar}>Copiar link</button>
                <a className="ghost" href={url} target="_blank" rel="noopener noreferrer">Abrir</a>
                <button type="button" className="ghost botao-perigo" onClick={trocar}>Gerar novo link</button>
              </div>
              {msg && <p className="resumo-entrada">{msg}</p>}
            </fieldset>
            )}
          </div>
        </PainelLateral>
      )}
    </>
  );
}

function Parametros() {
  const [rows, setRows] = useState<{ chave: string; valor: string; descricao: string | null }[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const carregar = async () => {
    const { data, error } = await supabase.from("parametros").select("*").order("chave");
    if (error) setErr(error.message);
    setRows(data ?? []);
    setValores(Object.fromEntries((data ?? []).map((p) => [p.chave, p.valor])));
  };
  useEffect(() => { void carregar(); }, []);
  const salvar = async (chave: string) => {
    setOk(""); setErr("");
    const { error } = await supabase.from("parametros").update({ valor: (valores[chave] ?? "").trim() }).eq("chave", chave);
    if (error) setErr(error.message); else { setOk(`Parâmetro ${chave} salvo.`); await carregar(); }
  };
  return (
    <>
      <TopoPagina titulo="Parâmetros" subtitulo="Prazos, tolerâncias e números do planejamento usados pelo bot." />
      {ok && <div className="ok">{ok}</div>}
      {err && <div className="err">{err}</div>}
      <section className="card">
        <div className="tw">
          <table>
            <thead><tr><th>Parâmetro</th><th>Valor</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.chave}>
                  <td><strong className="protocolo">{p.chave}</strong><small className="bloco texto-fraco">{p.descricao}</small>
                    {p.chave === "planejamento_telefones" && p.valor && <small className="bloco texto-fraco">{p.valor.split(/[,;\s]+/).filter(Boolean).map(formatarTelefone).join(" · ")}</small>}</td>
                  <td style={{ minWidth: 220 }}><input value={valores[p.chave] ?? ""} onChange={(e) => setValores({ ...valores, [p.chave]: e.target.value })} style={{ width: "100%" }} aria-label={p.chave} /></td>
                  <td><button type="button" className="ghost" disabled={(valores[p.chave] ?? "") === p.valor} onClick={() => salvar(p.chave)}>Salvar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const PERFIS: Record<string, string> = { admin: "Administrador", planejamento: "Planejamento", consulta: "Consulta" };

function Usuarios() {
  const { profile } = useApp();
  const [rows, setRows] = useState<{ id: string; nome: string; perfil: string; ativo: boolean }[]>([]);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [convidando, setConvidando] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", perfil: "planejamento" });
  const [ocupado, setOcupado] = useState(false);

  const carregar = async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("nome");
    if (error) setErr(error.message);
    setRows(data ?? []);
  };
  useEffect(() => { void carregar(); }, []);
  const atualizar = async (id: string, campos: Record<string, unknown>, msg: string) => {
    setOk(""); setErr("");
    const { error } = await supabase.from("profiles").update(campos).eq("id", id);
    if (error) setErr(error.message); else { setOk(msg); await carregar(); }
  };
  const convidar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setOcupado(true);
    try {
      await chamarApi("/api/usuarios", form);
      setOk(`Convite enviado para ${form.email}.`); setConvidando(false); setForm({ nome: "", email: "", perfil: "planejamento" }); await carregar();
    } catch (er) { setErr(er instanceof Error ? er.message : "Não foi possível convidar."); }
    finally { setOcupado(false); }
  };

  return (
    <>
      <TopoPagina titulo="Usuários do painel" subtitulo="Planejamento trata corridas e faturas; consulta só visualiza; administrador também mantém os cadastros.">
        <button type="button" className="pri" onClick={() => setConvidando(true)}>+ Convidar usuário</button>
      </TopoPagina>
      {ok && <div className="ok">{ok}</div>}
      {err && !convidando && <div className="err">{err}</div>}
      <section className="card">
        <div className="tw">
          <table>
            <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={u.ativo ? "" : "linha-inativa"}>
                  <td><div className="repor-produto">{u.nome}</div>{u.id === profile.id && <small className="texto-fraco">Você</small>}</td>
                  <td><select value={u.perfil} disabled={u.id === profile.id} onChange={(e) => atualizar(u.id, { perfil: e.target.value }, `${u.nome} agora é ${PERFIS[e.target.value]}.`)}>
                    {Object.entries(PERFIS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select></td>
                  <td>{u.ativo ? <span className="tag aprovada">Ativo</span> : <span className="tag reprovada">Inativo</span>}</td>
                  <td>{u.id !== profile.id && <button type="button" className="ghost" onClick={() => atualizar(u.id, { ativo: !u.ativo }, `${u.nome} ${u.ativo ? "desativado" : "reativado"}.`)}>{u.ativo ? "Desativar" : "Reativar"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {convidando && (
        <PainelLateral titulo="Convidar usuário" subtitulo="A pessoa recebe um e-mail para criar a senha." onFechar={() => setConvidando(false)} ocupado={ocupado} largura={520}>
          <form className="painel-corpo" onSubmit={convidar}>
            <fieldset className="secao">
              <legend>Dados</legend>
              <Campo rotulo="Nome" obrigatorio largo><input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></Campo>
              <Campo rotulo="E-mail" obrigatorio largo><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Campo>
              <Campo rotulo="Perfil" obrigatorio largo>
                <select value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value })}>
                  {Object.entries(PERFIS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </Campo>
            </fieldset>
            {err && <div className="err">{err}</div>}
            <footer className="painel-rodape">
              <button type="button" className="ghost" onClick={() => setConvidando(false)} disabled={ocupado}>Cancelar</button>
              <button className="pri" disabled={ocupado}>{ocupado ? "Enviando…" : "Enviar convite"}</button>
            </footer>
          </form>
        </PainelLateral>
      )}
    </>
  );
}
