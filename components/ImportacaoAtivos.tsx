"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { Badge, KpiCard } from "@/components/UI";
import { TopoPagina } from "@/components/Formulario";
import { useRetorno } from "@/components/Retorno";
import { lerPlanilhaXlsx } from "@/lib/xlsx-leitura";
import { COLUNAS_ATIVOS, compararAtivos, lerAtivos, normalizarCodigo, planilhaSuspeita, type Ativo, type Colaborador } from "@/lib/importacao-ativos";

type Pessoa = { id: string; nome: string; matricula: string | null; ativo: boolean };

const enderecoTexto = (x: { endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null }) =>
  [x.endereco, x.bairro, [x.cidade, x.uf].filter(Boolean).join("/")].filter(Boolean).join(", ") || null;
const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const em = <T,>(lista: T[], n: number) => { const partes: T[][] = []; for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n)); return partes; };
const erroBanco = (e: { message: string }) =>
  /does not exist|could not find the table|schema cache/i.test(e.message)
    ? "O banco ainda não tem a tabela de colaboradores. Rode supabase/023_colaboradores.sql no SQL Editor do Supabase e recarregue a página."
    : e.message;

async function lerTodos<T>(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).order("id").range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(erroBanco(error));
    saida.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return saida;
  }
}

export default function ImportacaoAtivos() {
  const { confirmar, avisar } = useRetorno();
  const [arquivo, setArquivo] = useState("");
  const [ativos, setAtivos] = useState<Ativo[] | null>(null);
  const [cadastro, setCadastro] = useState<Colaborador[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  // Novos e reativações vêm marcados (desmarque quem não deve entrar); ausentes vêm desmarcados (cada desligamento é confirmado).
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const carregarCadastro = async () => {
    const [c, p] = await Promise.all([
      lerTodos<Colaborador & { admissao: string | null }>("colaboradores", "id,codigo,nome,cargo,setor,admissao,situacao,ativo,endereco,bairro,cidade,uf,cep,nascimento"),
      lerTodos<Pessoa>("solicitantes", "id,nome,matricula,ativo", (q) => q.not("matricula", "is", null)),
    ]);
    setCadastro(c); setPessoas(p);
  };
  useEffect(() => { carregarCadastro().catch((e) => setErros([e instanceof Error ? e.message : "Não foi possível ler o cadastro."])); }, []);

  const resultado = useMemo(() => (ativos ? compararAtivos(ativos, cadastro) : null), [ativos, cadastro]);
  const pessoaPorMatricula = useMemo(() => new Map(pessoas.map((p) => [normalizarCodigo(p.matricula), p])), [pessoas]);
  const ativosNoCadastro = cadastro.filter((c) => c.ativo).length;

  const importar = async (f: File) => {
    setErros([]); setAvisos([]); setAtivos(null); setOcupado(true);
    try {
      const lido = lerAtivos(await lerPlanilhaXlsx(await f.arrayBuffer()));
      if (lido.erros.length) { setErros(lido.erros); return; }
      if (!lido.registros.length) { setErros(["Nenhum colaborador na planilha."]); return; }
      await carregarCadastro();
      setArquivo(f.name); setAvisos(lido.avisos); setDesmarcados(new Set()); setMarcados(new Set());
      setAtivos(lido.registros);
    } catch (e) {
      setErros([e instanceof Error ? e.message : "Não foi possível ler a planilha."]);
    } finally { setOcupado(false); }
  };

  /** Executa uma gravação, mostra o resultado e recompara a planilha com o cadastro atualizado. */
  const executar = async (acao: () => Promise<string>) => {
    setErros([]); setOcupado(true);
    try { avisar(await acao()); await carregarCadastro(); }
    catch (e) { setErros([e instanceof Error ? e.message : "Não foi possível gravar."]); }
    finally { setOcupado(false); }
  };
  const gravar = async (linhas: Record<string, unknown>[]) => {
    for (const parte of em(linhas, 200)) {
      const { error } = await supabase.from("colaboradores").upsert(parte, { onConflict: "codigo" });
      if (error) throw new Error(erroBanco(error));
    }
  };
  // Nascimento só é gravado quando a planilha o traz; senão o upsert apagaria o que já estava no cadastro
  const campos = (a: Ativo) => ({ codigo: a.codigo, nome: a.nome, cargo: a.cargo, setor: a.setor, admissao: a.admissao, situacao: a.situacao,
    endereco: a.endereco, bairro: a.bairro, cidade: a.cidade, uf: a.uf, cep: a.cep, ...(a.nascimento ? { nascimento: a.nascimento } : {}) });

  const alternar = (conj: Set<string>, set: (s: Set<string>) => void, codigo: string) => {
    const novo = new Set(conj);
    if (!novo.delete(codigo)) novo.add(codigo);
    set(novo);
  };

  const cadastrarNovos = () => {
    if (!resultado) return;
    const lista = resultado.novos.filter((a) => !desmarcados.has(a.codigo));
    if (!lista.length) return;
    void executar(async () => { await gravar(lista.map((a) => ({ ...campos(a), ativo: true, desligado_em: null }))); return `${lista.length} colaborador(es) cadastrado(s).`; });
  };
  const reativar = () => {
    if (!resultado) return;
    const lista = resultado.reativar.filter((a) => !desmarcados.has(a.codigo));
    if (!lista.length) return;
    void executar(async () => { await gravar(lista.map((a) => ({ ...campos(a), ativo: true, desligado_em: null }))); return `${lista.length} colaborador(es) reativado(s). A autorização para pedir táxi, se houver, continua como estava: reative em Pessoas autorizadas.`; });
  };
  const atualizar = () => {
    if (!resultado?.atualizar.length) return;
    const lista = resultado.atualizar;
    void executar(async () => { await gravar(lista.map(campos)); return `${lista.length} cadastro(s) atualizado(s).`; });
  };
  const desligar = async () => {
    if (!resultado) return;
    const lista = resultado.ausentes.filter((c) => marcados.has(c.codigo));
    if (!lista.length) return;
    const autorizados = lista.map((c) => pessoaPorMatricula.get(normalizarCodigo(c.codigo))).filter((p): p is Pessoa => !!p && p.ativo);
    const nomes = lista.slice(0, 5).map((c) => c.nome).join(", ") + (lista.length > 5 ? ` e mais ${lista.length - 5}` : "");
    const texto = `${nomes}. ${autorizados.length ? `${autorizados.length} deles também deixam de poder pedir táxi (Pessoas autorizadas).` : "Nenhum deles está em Pessoas autorizadas."} O histórico é mantido.`;
    if (!(await confirmar({ titulo: `Confirmar o desligamento de ${lista.length} colaborador(es)?`, texto, confirmar: "Confirmar desligamento", perigo: true }))) return;
    await executar(async () => {
      const agora = new Date().toISOString();
      for (const parte of em(lista.map((c) => c.id), 100)) {
        const { error } = await supabase.from("colaboradores").update({ ativo: false, desligado_em: agora }).in("id", parte);
        if (error) throw new Error(erroBanco(error));
      }
      for (const parte of em(autorizados.map((p) => p.id), 100)) {
        const { error } = await supabase.from("solicitantes").update({ ativo: false }).in("id", parte);
        if (error) throw new Error(`Colaboradores desligados, mas não foi possível desativar a autorização de táxi: ${error.message}`);
      }
      setMarcados(new Set());
      return `${lista.length} desligamento(s) confirmado(s)${autorizados.length ? `; ${autorizados.length} pessoa(s) autorizada(s) desativada(s)` : ""}.`;
    });
  };

  const r = resultado;
  const novosSel = r ? r.novos.filter((a) => !desmarcados.has(a.codigo)).length : 0;
  const reativarSel = r ? r.reativar.filter((a) => !desmarcados.has(a.codigo)).length : 0;
  const suspeita = !!r && planilhaSuspeita(r.ausentes.length, ativosNoCadastro);

  return (
    <>
      <TopoPagina titulo="Importação de Ativos" subtitulo="Envie a planilha de ativos do RH (mesmo modelo de sempre). Quem não está no cadastro é cadastrado; quem sumiu da planilha aparece como possível desligamento, para você confirmar.">
        <label className="botao-arquivo">{ocupado ? "Aguarde…" : "Enviar planilha (.xlsx)"}
          <input type="file" accept=".xlsx" hidden disabled={ocupado} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importar(f); }} />
        </label>
      </TopoPagina>

      {erros.length > 0 && <div className="err">{erros.slice(0, 8).map((e) => <div key={e}>{e}</div>)}{erros.length > 8 && <div>… e mais {erros.length - 8}.</div>}</div>}
      {avisos.length > 0 && <div className="resumo-entrada">{avisos.slice(0, 5).map((a) => <div key={a}>{a}</div>)}{avisos.length > 5 && <div>… e mais {avisos.length - 5} aviso(s).</div>}</div>}

      {!ativos && !erros.length && (
        <section className="card">
          <p className="empty">Nenhuma planilha enviada. Colunas lidas: {COLUNAS_ATIVOS.join(", ")}. A coluna Código identifica cada colaborador. {cadastro.length ? `Cadastro atual: ${ativosNoCadastro} ativo(s).` : "O cadastro ainda está vazio: na primeira importação, todos aparecem como novos."}</p>
        </section>
      )}

      {r && (
        <>
          <p className="texto-fraco" style={{ margin: "0 0 12px" }}>{arquivo}: {ativos!.length} colaborador(es) na planilha, {ativosNoCadastro} ativo(s) no cadastro.</p>
          <div className="kpis">
            <KpiCard value={r.novos.length} label="Novos a cadastrar" />
            <KpiCard value={r.ausentes.length} label="Fora da planilha (desligamento?)" alert={r.ausentes.length > 0} />
            <KpiCard value={r.reativar.length} label="Voltaram (reativar)" />
            <KpiCard value={r.atualizar.length} label="Dados diferentes" />
            <KpiCard value={r.iguais} label="Sem mudança" />
          </div>

          {suspeita && <div className="err"><strong>Confira a planilha antes de continuar.</strong> {r.ausentes.length} dos {ativosNoCadastro} colaboradores ativos não estão nela. Se ela for parcial ou de outro período, não confirme os desligamentos.</div>}

          <Secao titulo="Fora da planilha: confirmar desligamento" vazio="Todos os colaboradores ativos do cadastro estão na planilha." quantidade={r.ausentes.length}
            ajuda="Estes colaboradores estão ativos no cadastro, mas não vieram na planilha. Marque os que realmente saíram e confirme. Quem for confirmado fica inativo e, se estiver em Pessoas autorizadas, deixa de poder pedir táxi."
            acao={<>
              <button type="button" className="ghost" disabled={ocupado} onClick={() => setMarcados(marcados.size === r.ausentes.length ? new Set() : new Set(r.ausentes.map((c) => c.codigo)))}>{marcados.size === r.ausentes.length ? "Desmarcar todos" : "Marcar todos"}</button>
              <button type="button" className="ghost botao-perigo" disabled={ocupado || !marcados.size} onClick={desligar}>Confirmar desligamento ({marcados.size})</button>
            </>}>
            <table>
              <thead><tr><th /><th>Código</th><th>Nome</th><th>Cargo</th><th>Setor</th><th>Pede táxi?</th></tr></thead>
              <tbody>{r.ausentes.map((c) => {
                const p = pessoaPorMatricula.get(normalizarCodigo(c.codigo));
                return (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`Desligar ${c.nome}`} checked={marcados.has(c.codigo)} onChange={() => alternar(marcados, setMarcados, c.codigo)} /></td>
                    <td className="protocolo">{c.codigo}</td><td>{c.nome}</td><td>{c.cargo ?? "—"}</td><td>{c.setor ?? "—"}</td>
                    <td>{p ? (p.ativo ? <Badge variant="warning">Autorizado</Badge> : <Badge>Já inativo</Badge>) : "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Secao>

          <Secao titulo="Novos colaboradores" vazio="Nenhum colaborador novo na planilha." quantidade={r.novos.length}
            ajuda="Códigos que ainda não existem no cadastro. Desmarque quem não deve entrar. O cadastro de colaboradores não dá permissão de pedir táxi: isso continua em Pessoas autorizadas."
            acao={<button type="button" className="pri" disabled={ocupado || !novosSel} onClick={cadastrarNovos}>Cadastrar {novosSel} novo(s)</button>}>
            <table>
              <thead><tr><th /><th>Código</th><th>Nome</th><th>Cargo</th><th>Setor</th><th>Cidade / bairro</th></tr></thead>
              <tbody>{r.novos.map((a) => (
                <tr key={a.codigo}>
                  <td><input type="checkbox" aria-label={`Cadastrar ${a.nome}`} checked={!desmarcados.has(a.codigo)} onChange={() => alternar(desmarcados, setDesmarcados, a.codigo)} /></td>
                  <td className="protocolo">{a.codigo}</td><td>{a.nome}</td><td>{a.cargo ?? "—"}</td><td>{a.setor ?? "—"}</td><td>{[a.cidade, a.uf].filter(Boolean).join("/") || "—"}{a.bairro ? ` · ${a.bairro}` : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </Secao>

          {r.reativar.length > 0 && (
            <Secao titulo="Voltaram à planilha" quantidade={r.reativar.length} vazio=""
              ajuda="Estavam desligados no cadastro e aparecem de novo como ativos (readmissão). A autorização para pedir táxi não volta sozinha."
              acao={<button type="button" className="pri" disabled={ocupado || !reativarSel} onClick={reativar}>Reativar {reativarSel}</button>}>
              <table>
                <thead><tr><th /><th>Código</th><th>Nome</th><th>Cargo</th><th>Setor</th><th>Admissão</th></tr></thead>
                <tbody>{r.reativar.map((a) => (
                  <tr key={a.codigo}>
                    <td><input type="checkbox" aria-label={`Reativar ${a.nome}`} checked={!desmarcados.has(a.codigo)} onChange={() => alternar(desmarcados, setDesmarcados, a.codigo)} /></td>
                    <td className="protocolo">{a.codigo}</td><td>{a.nome}</td><td>{a.cargo ?? "—"}</td><td>{a.setor ?? "—"}</td><td>{dataBr(a.admissao)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Secao>
          )}

          {r.atualizar.length > 0 && (
            <Secao titulo="Dados diferentes do cadastro" quantidade={r.atualizar.length} vazio=""
              ajuda="Mesmo código, mas nome, cargo, setor, endereço ou outro dado mudaram na planilha (mudança de cargo, setor ou casa, correção de nome)."
              acao={<button type="button" className="ghost" disabled={ocupado} onClick={atualizar}>Atualizar {r.atualizar.length}</button>}>
              <table>
                <thead><tr><th>Código</th><th>Nome</th><th>Cargo</th><th>Setor</th><th>Endereço</th></tr></thead>
                <tbody>{r.atualizar.map((a) => {
                  const antes = cadastro.find((c) => c.id === a.id);
                  const celula = (novo: string | null, velho: string | null | undefined) => (novo ?? "") === (velho ?? "") ? (novo ?? "—") : <><s className="texto-fraco">{velho || "—"}</s> → {novo ?? "—"}</>;
                  return <tr key={a.codigo}><td className="protocolo">{a.codigo}</td><td>{celula(a.nome, antes?.nome)}</td><td>{celula(a.cargo, antes?.cargo)}</td><td>{celula(a.setor, antes?.setor)}</td><td>{celula(enderecoTexto(a), antes ? enderecoTexto(antes) : null)}</td></tr>;
                })}</tbody>
              </table>
            </Secao>
          )}
        </>
      )}
    </>
  );
}

function Secao({ titulo, quantidade, vazio, ajuda, acao, children }: { titulo: string; quantidade: number; vazio: string; ajuda: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{titulo} <Badge>{quantidade}</Badge></h3>
        {quantidade > 0 && <div className="row">{acao}</div>}
      </div>
      {quantidade === 0 ? <p className="empty">{vazio}</p> : <>
        <p className="secao-ajuda">{ajuda}</p>
        <div className="tw">{children}</div>
      </>}
    </section>
  );
}
