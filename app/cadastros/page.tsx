"use client";
import { textoPortal } from "@/lib/portal-texto";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import Crud from "@/components/Crud";
import { Campo, PainelLateral, TopoPagina } from "@/components/Formulario";
import { useApp } from "@/components/AuthGate";
import { formatarTelefone } from "@/lib/telefone";
import { linkWhatsApp, msgLinkPedido } from "@/lib/whatsapp/link";
import { useRetorno } from "@/components/Retorno";
import { baixarXlsx } from "@/lib/xlsx";
import { lerPlanilhaXlsx } from "@/lib/xlsx-leitura";
import { textoDias } from "@/lib/recorrentes";
import { COLUNAS_PLANILHA, ROTULO_MODALIDADE, ROTULO_VEICULO, lerTabelaPrecos, normalizar } from "@/lib/precos";

type Aba = "solicitantes" | "fornecedores" | "precos" | "unidades" | "locais" | "motivos" | "recorrentes" | "feriados" | "parametros" | "usuarios";
const ABAS: [Aba, string][] = [
  ["solicitantes", "Pessoas autorizadas"], ["fornecedores", "Fornecedores"], ["precos", "Tabela de preços"],
  ["unidades", "Unidades"], ["locais", "Locais frequentes"], ["motivos", "Motivos"], ["recorrentes", "Corridas recorrentes"], ["feriados", "Feriados"], ["parametros", "Parâmetros"], ["usuarios", "Usuários do painel"],
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
          { key: "fornecedor_padrao_id", label: "Fornecedor padrão", type: "select", opcoes: { tabela: "fornecedores", rotulo: (r) => r.nome }, ajuda: "A corrida vai sempre ao fornecedor mais barato para o trecho. O padrão só desempata preços iguais ou vale onde ninguém tem preço na tabela." },
          { key: "limite_mensal", label: "Limite mensal (R$)", type: "number", esconderNaTabela: true, ajuda: "Gasto acima disso no mês gera alerta ao planejamento. Vazio: sem limite." },
        ]} />}

      {aba === "fornecedores" && <Crud key="forn" table="fornecedores" title="Fornecedores" nomeItem="fornecedor" ordem="nome"
        subtitulo="Recebem as corridas pelo WhatsApp. Cada corrida vai ao fornecedor mais barato para o trecho (Tabela de preços); se ele recusar ou não responder, ao próximo mais barato."
        acoesExtras={(r, recarregar) => r.ativo ? <LinkPortal fornecedor={r} recarregar={recarregar} /> : null}
        fields={[
          { key: "nome", label: "Nome", required: true },
          { key: "telefone_whatsapp", label: "WhatsApp que recebe as corridas", required: true, mascara: "whatsapp", unico: true, placeholder: "(11) 3333-4444" },
          { key: "email", label: "E-mail de login do portal", type: "email", unico: true, placeholder: "contato@fornecedor.com.br", ajuda: "Com o código de acesso (tela Portais dos fornecedores) como senha, é o login do portal do fornecedor." },
          { key: "cnpj", label: "CNPJ", mascara: "cnpj" },
          { key: "prazo_resposta_min", label: "Prazo para responder (min)", type: "number", required: true, ajuda: "Corridas imediatas. Agendadas usam o parâmetro prazo_agendada_min." },
          { key: "bandeirada", label: "Bandeirada (R$)", type: "number", esconderNaTabela: true, ajuda: "Com o valor por km, calcula a tarifa de referência de cada corrida." },
          { key: "valor_km", label: "Valor por km (R$)", type: "number", esconderNaTabela: true, ajuda: "Tarifa por km rodado. Usada no comparativo KM × tabela (Relatórios) e no alerta de valor acima da referência (tolerancia_trajeto_pct)." },
        ]} />}

      {aba === "precos" && <TabelaPrecos />}

      {aba === "unidades" && <Crud key="uni" table="unidades" title="Unidades" nomeItem="unidade" ordem="nome"
        subtitulo="Unidades da empresa. As que têm endereço aparecem primeiro nas sugestões de endereço do pedido e como opção no WhatsApp."
        fields={[
          { key: "nome", label: "Nome", required: true, unico: true, placeholder: "CD Extrema" },
          { key: "endereco_padrao", label: "Endereço", largo: true, placeholder: "Rua, número, bairro, cidade - UF", ajuda: "Com número e cidade, para o mapa achar o lugar certo. Aparece no app de pedido como origem e destino." },
        ]} />}

      {aba === "locais" && <Crud key="loc" table="locais" title="Locais frequentes" nomeItem="local" ordem="nome"
        subtitulo="Lugares que não são unidades da empresa, mas para onde se vai com frequência: hospital, aeroporto, rodoviária, cliente. Aparecem primeiro nas sugestões de endereço do pedido e como opção no WhatsApp, junto com as unidades."
        fields={[
          { key: "nome", label: "Nome", required: true, unico: true, placeholder: "Pronto Socorro Municipal" },
          { key: "endereco", label: "Endereço", required: true, largo: true, placeholder: "Rua, número, bairro, cidade - UF", ajuda: "Com número e cidade, para o mapa achar o lugar certo." },
        ]} />}

      {aba === "motivos" && <Crud key="mot" table="motivos" title="Motivos de corrida" nomeItem="motivo" ordem="ordem"
        subtitulo="Opções que a pessoa escolhe ao pedir o táxi, no bot e na página de pedido. Desative os que não se aplicam; a pessoa ainda pode escrever outro motivo."
        fields={[
          { key: "nome", label: "Motivo", required: true, unico: true, placeholder: "Visita a fornecedor" },
          { key: "ordem", label: "Ordem", type: "number", ajuda: "Menor aparece primeiro. No WhatsApp, até 3 motivos viram botões; com mais, viram uma lista (até 10)." },
        ]} />}

      {aba === "recorrentes" && <Recorrentes />}
      {aba === "feriados" && <Feriados />}
      {aba === "parametros" && <Parametros />}
      {aba === "usuarios" && <Usuarios />}
    </>
  );
}

/** Envia ao solicitante o link pessoal de pedido, copia ou troca o link (o antigo deixa de valer). */
function LinkPedido({ pessoa, recarregar }: { pessoa: { id: string; nome: string; telefone_whatsapp: string; token_pedido?: string | null; codigo_acesso?: string | null }; recarregar: () => Promise<void> }) {
  const { confirmar } = useRetorno();
  const [aberto, setAberto] = useState(false);
  // Com pedido_exige_codigo = sim, o link pede o código de 4 números na primeira vez em cada aparelho
  const [exigeCodigo, setExigeCodigo] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    supabase.from("parametros").select("valor").eq("chave", "pedido_exige_codigo").maybeSingle()
      .then(({ data }) => setExigeCodigo(/^(sim|s|true|1)$/i.test(String(data?.valor ?? "").trim())));
  }, [aberto]);
  const novoCodigo = async () => {
    if (!(await confirmar({ titulo: `Gerar novo código para ${pessoa.nome}?`, texto: "Os aparelhos já liberados precisam do código novo.", confirmar: "Gerar novo código" }))) return;
    const codigo = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const { error } = await supabase.from("solicitantes").update({ codigo_acesso: codigo }).eq("id", pessoa.id);
    setMsg(error ? (/codigo_acesso/.test(error.message) ? "Rode supabase/020_seguranca_desempenho.sql no Supabase." : error.message) : `Novo código: ${codigo}. Envie para a pessoa.`);
    await recarregar();
  };
  const [msg, setMsg] = useState("");
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${base}/pedir/${pessoa.token_pedido}`;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setMsg("Link copiado."); } catch { setMsg("Não foi possível copiar; selecione o link e copie."); }
  };
  const trocar = async () => {
    if (!(await confirmar({ titulo: `Gerar novo link para ${pessoa.nome}?`, texto: "O link atual para de funcionar na hora. Depois envie o novo para a pessoa.", confirmar: "Gerar novo link", perigo: true }))) return;
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
              <a className="botao-whatsapp" href={linkWhatsApp(pessoa.telefone_whatsapp, msgLinkPedido(pessoa.nome, base, pessoa.token_pedido, exigeCodigo ? pessoa.codigo_acesso : null))} target="_blank" rel="noopener noreferrer">Enviar para {formatarTelefone(pessoa.telefone_whatsapp)} pelo WhatsApp</a>
              <div className="row">
                <button type="button" className="ghost" onClick={copiar}>Copiar link</button>
                <a className="ghost" href={url} target="_blank" rel="noopener noreferrer">Abrir</a>
                <button type="button" className="ghost botao-perigo" onClick={trocar}>Gerar novo link</button>
              </div>
              {pessoa.codigo_acesso && (
                <p className="secao-ajuda">Código de acesso: <strong className="protocolo">{pessoa.codigo_acesso}</strong>{" "}
                  {exigeCodigo ? "— pedido na primeira vez em cada celular (vai junto na mensagem)." : "— só é pedido se o parâmetro pedido_exige_codigo estiver como sim."}{" "}
                  <button type="button" className="atalho" onClick={novoCodigo}>Gerar novo código</button></p>
              )}
              {msg && <p className="resumo-entrada">{msg}</p>}
            </fieldset>
            )}
          </div>
        </PainelLateral>
      )}
    </>
  );
}

/** Link fixo do portal do fornecedor: todas as corridas dele, sem depender de cada mensagem. */
function LinkPortal({ fornecedor, recarregar }: { fornecedor: { id: string; nome: string; telefone_whatsapp: string; token_portal?: string | null; codigo_acesso?: string | null; email?: string | null }; recarregar: () => Promise<void> }) {
  const { confirmar } = useRetorno();
  const [aberto, setAberto] = useState(false);
  const [msg, setMsg] = useState("");
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${base}/fornecedor/${fornecedor.token_portal}`;
  const texto = textoPortal(fornecedor, url);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); setMsg("Link copiado."); } catch { setMsg("Não foi possível copiar; selecione o link e copie."); }
  };
  const trocar = async () => {
    if (!(await confirmar({ titulo: `Gerar novo link do portal de ${fornecedor.nome}?`, texto: "O link atual para de funcionar na hora.", confirmar: "Gerar novo link", perigo: true }))) return;
    const novo = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const { error } = await supabase.from("fornecedores").update({ token_portal: novo }).eq("id", fornecedor.id);
    setMsg(error ? error.message : "Novo link gerado. Envie para o fornecedor.");
    await recarregar();
  };
  return (
    <>
      <button type="button" className="ghost" onClick={() => setAberto(true)}>Link do portal</button>
      {aberto && (
        <PainelLateral titulo="Portal do fornecedor" subtitulo={fornecedor.nome} onFechar={() => setAberto(false)} largura={520}>
          <div className="painel-corpo">
            {!fornecedor.token_portal ? (
              <p className="err">O banco ainda não tem o portal do fornecedor. No Supabase, abra o SQL Editor, rode <strong>supabase/003_melhorias.sql</strong> e recarregue esta página.</p>
            ) : (
            <fieldset className="secao" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
              <legend>Link fixo</legend>
              <p className="secao-ajuda">Para entrar no portal, o fornecedor usa o e-mail cadastrado e, como senha, o código de acesso.{fornecedor.codigo_acesso && <> Código: <strong className="protocolo">{fornecedor.codigo_acesso}</strong>.</>}{!fornecedor.email && <span className="err"> Cadastre o e-mail deste fornecedor para ele conseguir entrar.</span>}</p>
              <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link do portal" />
              <a className="botao-whatsapp" href={linkWhatsApp(fornecedor.telefone_whatsapp, texto)} target="_blank" rel="noopener noreferrer">Enviar para {formatarTelefone(fornecedor.telefone_whatsapp)} pelo WhatsApp</a>
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

/**
 * Tabela de preços combinados com cada fornecedor. Fora de Extrema, uma linha por cidade; dentro, por bairro
 * (linha sem bairro = resto da cidade). O sistema escolhe veículo e modalidade pelos passageiros da corrida.
 */
function TabelaPrecos() {
  const { confirmar, avisar } = useRetorno();
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  const exportar = async () => {
    const [{ data: linhas, error }, { data: forns }] = await Promise.all([
      supabase.from("precos_tabela").select("*").order("localidade"),
      supabase.from("fornecedores").select("id,nome"),
    ]);
    if (error) { avisar(error.message, "erro"); return; }
    const nome = new Map((forns ?? []).map((f) => [f.id, f.nome]));
    baixarXlsx("tabela-de-precos.xlsx", "Tabela de preços",
      COLUNAS_PLANILHA.map((t) => ({ titulo: t, largura: t === "Localidade" || t === "Apelidos" ? 26 : t === "Valor" ? 12 : 16, formato: t === "Valor" ? "moeda" as const : undefined })),
      (linhas ?? []).filter((l) => l.ativo).map((l) => [nome.get(l.fornecedor_id) ?? "", l.localidade, l.cidade, l.uf, l.bairro, l.apelidos,
        l.modalidade === "qualquer" ? "" : ROTULO_MODALIDADE[l.modalidade as "unico" | "diversos"], ROTULO_VEICULO[l.veiculo as "passeio"], Number(l.valor)]));
  };

  const importar = async (arquivo: File) => {
    setErros([]); setOcupado(true);
    try {
      const { data: forns } = await supabase.from("fornecedores").select("id,nome");
      const { itens, erros } = lerTabelaPrecos(await lerPlanilhaXlsx(await arquivo.arrayBuffer()), forns ?? []);
      if (erros.length) { setErros(erros); return; }
      if (!itens.length) { setErros(["Nenhuma linha de preço na planilha."]); return; }
      // Mesma cidade/bairro/modalidade/veículo repetida: vale a última linha
      const unicos = [...new Map(itens.map((i) => [[i.fornecedor_id, normalizar(i.cidade), normalizar(i.bairro), i.modalidade, i.veiculo].join("|"), i])).values()];
      const porForn = new Map<string, number>();
      for (const i of unicos) porForn.set(i.fornecedor_id, (porForn.get(i.fornecedor_id) ?? 0) + 1);
      const resumo = [...porForn].map(([id, n]) => `${forns?.find((f) => f.id === id)?.nome}: ${n} preço(s)`).join("; ");
      if (!(await confirmar({ titulo: "Substituir a tabela de preços?", texto: `A tabela atual destes fornecedores será trocada pela da planilha. ${resumo}.`, confirmar: "Substituir" }))) return;
      const { error: e1 } = await supabase.from("precos_tabela").delete().in("fornecedor_id", [...porForn.keys()]);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from("precos_tabela").insert(unicos);
      if (e2) throw new Error(e2.message);
      avisar(`Tabela importada: ${resumo}.`);
      setVersao((v) => v + 1);
    } catch (e) {
      setErros([e instanceof Error ? e.message : "Não foi possível importar a planilha."]);
    } finally { setOcupado(false); }
  };

  return (
    <Crud key={`precos-${versao}`} table="precos_tabela" title="Tabela de preços" nomeItem="preço" ordem="localidade"
      subtitulo="Valores combinados com cada fornecedor. Fora de Extrema, por cidade; dentro, por bairro (sem bairro = resto da cidade). O veículo e o tipo de destino saem dos passageiros: 1 = Passeio, destino único; 2 a 4 = Passeio, diversos destinos; 5 e 6 = Spin; 7 ou mais = Van."
      aviso={<>
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="ghost" onClick={exportar}>Baixar planilha</button>
          <label className="ghost botao-arquivo">{ocupado ? "Importando…" : "Importar planilha (.xlsx)"}
            <input type="file" accept=".xlsx" hidden disabled={ocupado} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importar(f); }} />
          </label>
          <span className="texto-fraco" style={{ fontSize: 13 }}>Para editar em lote: baixe, ajuste no Excel e importe de volta (substitui a tabela dos fornecedores da planilha).</span>
        </div>
        {erros.length > 0 && <div className="err">{erros.slice(0, 8).map((e) => <div key={e}>{e}</div>)}{erros.length > 8 && <div>… e mais {erros.length - 8}.</div>}</div>}
      </>}
      fields={[
        { key: "localidade", label: "Localidade", required: true, placeholder: "Toledo - Pereiras", ajuda: "Como aparece na tabela do fornecedor." },
        { key: "fornecedor_id", label: "Fornecedor", type: "select", required: true, opcoes: { tabela: "fornecedores", rotulo: (r) => r.nome } },
        { key: "cidade", label: "Cidade", required: true, placeholder: "Toledo" },
        { key: "bairro", label: "Bairro", placeholder: "Pereiras", ajuda: "Vazio = a cidade toda (em Extrema, vale para os bairros sem linha própria)." },
        { key: "apelidos", label: "Outros nomes do bairro", esconderNaTabela: true, placeholder: "Bairro dos Pereiras, Pereira", ajuda: "Separados por vírgula; ajudam a reconhecer o endereço." },
        { key: "uf", label: "UF", esconderNaTabela: true, placeholder: "MG" },
        { key: "modalidade", label: "Destino", type: "select", required: true, opcoes: { fixas: [{ valor: "unico", rotulo: "Destino único" }, { valor: "diversos", rotulo: "Diversos destinos" }, { valor: "qualquer", rotulo: "Qualquer" }] } },
        { key: "veiculo", label: "Veículo", type: "select", required: true, opcoes: { fixas: [{ valor: "passeio", rotulo: "Passeio (4 lugares)" }, { valor: "spin", rotulo: "Spin (6 lugares)" }, { valor: "van", rotulo: "Van" }] } },
        { key: "valor", label: "Valor (R$)", type: "number", required: true, moeda: true },
      ]} />
  );
}

function Parametros() {
  const { avisar } = useRetorno();
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
    if (error) setErr(error.message); else { avisar(`Parâmetro ${chave} salvo.`); await carregar(); }
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
  const { avisar } = useRetorno();
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
    if (error) setErr(error.message); else { avisar(msg); await carregar(); }
  };
  const convidar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setOcupado(true);
    try {
      await chamarApi("/api/usuarios", form);
      avisar(`Convite enviado para ${form.email}.`); setConvidando(false); setForm({ nome: "", email: "", perfil: "planejamento" }); await carregar();
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

/** Feriados: não contam como dia útil nos prazos do espelho (5 dias úteis para responder; lembrete no 3º). */
function Feriados() {
  const { avisar, confirmar } = useRetorno();
  const [rows, setRows] = useState<{ data: string; nome: string }[]>([]);
  const [nova, setNova] = useState({ data: "", nome: "" });
  const [err, setErr] = useState("");
  const carregar = async () => {
    const { data, error } = await supabase.from("feriados").select("data,nome").gte("data", `${new Date().getFullYear() - 1}-01-01`).order("data");
    setErr(error ? (/feriados/.test(error.message) ? "Rode supabase/021_qualidade.sql no Supabase para cadastrar feriados." : error.message) : "");
    setRows(data ?? []);
  };
  useEffect(() => { void carregar(); }, []);
  const incluir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nova.data || nova.nome.trim().length < 3) { setErr("Informe a data e o nome do feriado."); return; }
    const { error } = await supabase.from("feriados").upsert({ data: nova.data, nome: nova.nome.trim() });
    if (error) { setErr(error.message); return; }
    avisar("Feriado salvo."); setNova({ data: "", nome: "" }); await carregar();
  };
  const remover = async (f: { data: string; nome: string }) => {
    if (!(await confirmar({ titulo: `Remover ${f.nome}?`, texto: "O dia volta a contar como dia útil nos prazos.", confirmar: "Remover", perigo: true }))) return;
    const { error } = await supabase.from("feriados").delete().eq("data", f.data);
    if (error) setErr(error.message); else { avisar("Feriado removido."); await carregar(); }
  };
  const dataBr = (d: string) => d.split("-").reverse().join("/");
  const semana = (d: string) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${d}T12:00:00`).getDay()];
  return (
    <>
      <TopoPagina titulo="Feriados" subtitulo="Não contam como dia útil nos prazos do espelho mensal. Os nacionais já vêm cadastrados; inclua os municipais (Extrema) e as pontes." />
      {err && <div className="err">{err}</div>}
      <section className="card">
        <form className="row" onSubmit={incluir} style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <Campo rotulo="Data"><input type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} /></Campo>
          <Campo rotulo="Nome"><input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Aniversário de Extrema" /></Campo>
          <button className="pri">Incluir</button>
        </form>
        <div className="tw"><table className="tabela-compacta">
          <thead><tr><th>Data</th><th>Feriado</th><th /></tr></thead>
          <tbody>{rows.map((f) => (
            <tr key={f.data}><td>{dataBr(f.data)} <span className="texto-fraco">({semana(f.data)})</span></td><td>{f.nome}</td>
              <td className="num"><button type="button" className="ghost botao-perigo" onClick={() => void remover(f)}>Remover</button></td></tr>
          ))}</tbody>
        </table></div>
        {!rows.length && !err && <p className="empty">Nenhum feriado cadastrado.</p>}
      </section>
    </>
  );
}

type Recorrente = {
  id: string; solicitante_id: string; dias_semana: number[]; hora: string; origem: string; destino: string; qtd_passageiros: number;
  outros_passageiros: string | null; motivo: string; observacoes: string | null; pular_feriados: boolean; fim: string | null; ultima_data: string | null; ativo: boolean;
  solicitantes?: { nome: string } | null;
};
const DIAS_SEMANA: [number, string][] = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]];
const RECORRENTE_VAZIA = { solicitante_id: "", dias: [1, 2, 3, 4, 5], hora: "07:00", origem: "", destino: "", qtd_passageiros: "1", outros_passageiros: "", motivo: "", observacoes: "", pular_feriados: true, fim: "" };

/** Corridas que se repetem (ex.: turno de seg a sex às 7h): o agendador gera cada uma com a antecedência do parâmetro e envia ao fornecedor. */
function Recorrentes() {
  const { avisar, confirmar } = useRetorno();
  const [rows, setRows] = useState<Recorrente[]>([]);
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [form, setForm] = useState(RECORRENTE_VAZIA);
  const [aberto, setAberto] = useState(false);
  const [err, setErr] = useState("");
  const carregar = async () => {
    const [r, s, m] = await Promise.all([
      supabase.from("corridas_recorrentes").select("*, solicitantes(nome)").order("hora"),
      supabase.from("solicitantes").select("id,nome").eq("ativo", true).order("nome"),
      supabase.from("motivos").select("nome").eq("ativo", true).order("ordem"),
    ]);
    setErr(r.error ? (/corridas_recorrentes/.test(r.error.message) ? "Rode supabase/022_aprovacao_recorrentes.sql no Supabase para cadastrar corridas recorrentes." : r.error.message) : "");
    setRows((r.data ?? []) as Recorrente[]); setPessoas(s.data ?? []); setMotivos((m.data ?? []).map((x: { nome: string }) => x.nome));
  };
  useEffect(() => { void carregar(); }, []);
  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (!form.solicitante_id || !form.dias.length || !form.hora || form.origem.trim().length < 4 || form.destino.trim().length < 4 || !form.motivo.trim()) {
      setErr("Preencha pessoa, dias, horário, origem, destino e motivo."); return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("corridas_recorrentes").insert({
      solicitante_id: form.solicitante_id, dias_semana: form.dias, hora: form.hora, origem: form.origem.trim(), destino: form.destino.trim(),
      qtd_passageiros: Math.max(1, Math.min(15, Number(form.qtd_passageiros) || 1)), outros_passageiros: form.outros_passageiros.trim() || null,
      motivo: form.motivo.trim(), observacoes: form.observacoes.trim() || null, pular_feriados: form.pular_feriados, fim: form.fim || null, criado_por: u.user?.id ?? null,
    });
    if (error) { setErr(error.message); return; }
    avisar("Corrida recorrente salva. O agendador gera cada corrida com a antecedência do parâmetro recorrente_antecedencia_horas.");
    setForm(RECORRENTE_VAZIA); setAberto(false); await carregar();
  };
  const alternar = async (r: Recorrente) => {
    const { error } = await supabase.from("corridas_recorrentes").update({ ativo: !r.ativo }).eq("id", r.id);
    if (error) setErr(error.message); else await carregar();
  };
  const excluir = async (r: Recorrente) => {
    if (!(await confirmar({ titulo: "Excluir esta corrida recorrente?", texto: "As corridas já geradas continuam; as próximas não serão mais criadas.", confirmar: "Excluir", perigo: true }))) return;
    const { error } = await supabase.from("corridas_recorrentes").delete().eq("id", r.id);
    if (error) setErr(error.message); else { avisar("Excluída."); await carregar(); }
  };
  return (
    <>
      <TopoPagina titulo="Corridas recorrentes" subtitulo="Trajetos fixos (turno, rota de visita): cada corrida é criada sozinha antes do horário e enviada ao fornecedor. Feriados podem ser pulados.">
        <button type="button" className="pri" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar" : "Nova recorrente"}</button>
      </TopoPagina>
      {err && <div className="err">{err}</div>}
      {aberto && (
        <form className="card" onSubmit={salvar}>
          <div className="form-mov-grade">
            <Campo rotulo="Pessoa autorizada" obrigatorio><select value={form.solicitante_id} onChange={campo("solicitante_id")}><option value="">Escolha</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Campo>
            <Campo rotulo="Horário" obrigatorio><input type="time" value={form.hora} onChange={campo("hora")} /></Campo>
            <Campo rotulo="Dias da semana" obrigatorio largo>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{DIAS_SEMANA.map(([n, r]) => (
                <label key={n} className="row" style={{ gap: 4 }}><input type="checkbox" checked={form.dias.includes(n)}
                  onChange={(e) => setForm({ ...form, dias: e.target.checked ? [...form.dias, n].sort() : form.dias.filter((d) => d !== n) })} />{r}</label>
              ))}</div>
            </Campo>
            <Campo rotulo="Origem" obrigatorio largo><input value={form.origem} onChange={campo("origem")} placeholder="Rua, número, bairro, cidade" /></Campo>
            <Campo rotulo="Destino" obrigatorio largo><input value={form.destino} onChange={campo("destino")} placeholder="Rua, número, bairro, cidade" /></Campo>
            <Campo rotulo="Passageiros"><input type="number" min={1} max={15} value={form.qtd_passageiros} onChange={campo("qtd_passageiros")} /></Campo>
            <Campo rotulo="Outros passageiros"><input value={form.outros_passageiros} onChange={campo("outros_passageiros")} placeholder="Nomes (opcional)" /></Campo>
            <Campo rotulo="Motivo" obrigatorio><input list="motivos-recorrentes" value={form.motivo} onChange={campo("motivo")} /><datalist id="motivos-recorrentes">{motivos.map((m) => <option key={m} value={m} />)}</datalist></Campo>
            <Campo rotulo="Termina em" ajuda="Vazio = sem data para acabar."><input type="date" value={form.fim} onChange={campo("fim")} /></Campo>
            <Campo rotulo="Observações para o fornecedor" largo><input value={form.observacoes} onChange={campo("observacoes")} /></Campo>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.pular_feriados} onChange={(e) => setForm({ ...form, pular_feriados: e.target.checked })} /> Não gerar em feriados (Cadastros › Feriados)</label>
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="pri">Salvar</button></div>
        </form>
      )}
      <section className="card">
        <div className="tw"><table>
          <thead><tr><th>Pessoa</th><th>Quando</th><th>Trajeto</th><th className="num">Passageiros</th><th>Última gerada</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.ativo ? "" : "texto-fraco"}>
              <td>{r.solicitantes?.nome ?? "—"}<small className="bloco texto-fraco">{r.motivo}</small></td>
              <td>{textoDias(r.dias_semana)} às {r.hora.slice(0, 5)}{r.fim ? <small className="bloco texto-fraco">até {r.fim.split("-").reverse().join("/")}</small> : null}</td>
              <td>{r.origem} → {r.destino}</td><td className="num">{r.qtd_passageiros}</td>
              <td>{r.ultima_data ? r.ultima_data.split("-").reverse().join("/") : "—"}</td>
              <td className="num"><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => void alternar(r)}>{r.ativo ? "Pausar" : "Reativar"}</button>
                <button type="button" className="ghost botao-perigo" onClick={() => void excluir(r)}>Excluir</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
        {!rows.length && !err && <p className="empty">Nenhuma corrida recorrente.</p>}
      </section>
    </>
  );
}
