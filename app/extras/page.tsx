"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { brl } from "@/lib/datas";
import { Badge, KpiCard } from "@/components/UI";
import { Campo, TopoPagina, normalizarTexto } from "@/components/Formulario";
import { useRetorno } from "@/components/Retorno";
import { lerPlanilhaXlsx } from "@/lib/xlsx-leitura";
import { casarLista, linhasDaLista, type ResultadoLista } from "@/lib/extras-lista";

type Colab = { id: string; codigo: string; nome: string; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };
type Opcao = { id: string; nome: string };
type Pessoa = { id: string; nome: string; endereco: string; bairro: string | null; cidade: string | null; uf: string | null; localizacao: string };
type Carro = {
  passageiros: number; paradas: number; veiculo: string; km: number | null; km_estimado: boolean; valor: number | null; fornecedor: string | null;
  descricao_preco: string | null; sem_preco: boolean; sem_local: boolean; km_est: number | null; preco_por: string | null; cidades: string[]; pessoas: Pessoa[];
};
type Plano = { unidade: { id: string; nome: string; endereco: string }; sentido: "entrada" | "saida"; carros: Carro[]; resumo: { carros: number; passageiros: number; km: number; valor: number; semPreco: number }; avisos: string[] };
type Gerada = { protocolo: string; fornecedor: string | null; passageiros: number; aviso?: string; whatsapp?: string };

const VEICULOS: [string, string][] = [["passeio", "Passeio (até 4 pessoas)"], ["spin", "Spin (até 6 pessoas)"], ["van", "Van (até 15 pessoas)"]];
const ROTULO_VEICULO: Record<string, string> = { passeio: "Passeio", spin: "Spin", van: "Van" };
const LOTE_LOCALIZAR = 20;
const LOTE_KM = 8;
const LOTE_GERAR = 6;
const enderecoCurto = (c: Pick<Colab, "endereco" | "bairro" | "cidade" | "uf">) =>
  [c.endereco, c.bairro, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
const em = <T,>(lista: T[], n: number) => { const partes: T[][] = []; for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n)); return partes; };

export default function Extras() {
  const { confirmar, avisar } = useRetorno();
  const [colabs, setColabs] = useState<Colab[]>([]);
  const [unidades, setUnidades] = useState<Opcao[]>([]);
  const [solicitantes, setSolicitantes] = useState<Opcao[]>([]);
  const [erroCarga, setErroCarga] = useState("");
  const [escolhidos, setEscolhidos] = useState<Colab[]>([]);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState("");
  const [relatorioLista, setRelatorioLista] = useState<ResultadoLista<Colab> | null>(null);
  const [sentido, setSentido] = useState<"saida" | "entrada">("saida");
  const [quando, setQuando] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [solicitanteId, setSolicitanteId] = useState("");
  const [veiculoMaximo, setVeiculoMaximo] = useState("van");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [lote, setLote] = useState("");
  const [ocupado, setOcupado] = useState<"" | "planejar" | "gerar">("");
  const [progresso, setProgresso] = useState("");
  const [medindo, setMedindo] = useState("");
  const [erro, setErro] = useState("");
  const [geradas, setGeradas] = useState<Gerada[] | null>(null);
  // Cada plano novo cancela a medição de km do anterior
  const versaoPlano = useRef(0);

  useEffect(() => {
    (async () => {
      const [c, u, s] = await Promise.all([
        supabase.from("colaboradores").select("id,codigo,nome,endereco,bairro,cidade,uf,cep").eq("ativo", true).order("nome").limit(5000),
        supabase.from("unidades").select("id,nome").eq("ativo", true).order("nome"),
        supabase.from("solicitantes").select("id,nome").eq("ativo", true).order("nome"),
      ]);
      if (c.error) {
        setErroCarga(/does not exist|could not find the table|schema cache/i.test(c.error.message)
          ? "O banco ainda não tem o cadastro de colaboradores. Rode supabase/023, 024 e 025 (colaboradores) no SQL Editor do Supabase e recarregue a página."
          : c.error.message);
        return;
      }
      setColabs((c.data ?? []) as Colab[]);
      setUnidades((u.data ?? []) as Opcao[]);
      setSolicitantes((s.data ?? []) as Opcao[]);
      if (u.data?.length === 1) setUnidadeId(u.data[0].id);
    })().catch((e) => setErroCarga(e instanceof Error ? e.message : "Não foi possível carregar os cadastros."));
  }, []);

  const sugestoes = useMemo(() => {
    const termo = normalizarTexto(busca);
    if (termo.length < 2) return [];
    const jaTem = new Set(escolhidos.map((c) => c.id));
    return colabs.filter((c) => !jaTem.has(c.id) && (normalizarTexto(c.nome).includes(termo) || c.codigo.includes(termo))).slice(0, 8);
  }, [busca, colabs, escolhidos]);

  const mudou = () => { versaoPlano.current++; setPlano(null); setGeradas(null); setErro(""); setMedindo(""); };
  const adicionar = (c: Colab) => { setEscolhidos((l) => [...l, c]); setBusca(""); mudou(); };
  const remover = (id: string) => { setEscolhidos((l) => l.filter((c) => c.id !== id)); mudou(); };

  /** Lista colada ou planilha: cada linha é um código ou um nome. */
  const adicionarLista = (entradas: string[]) => {
    const r = casarLista(entradas, colabs, new Set(escolhidos.map((c) => c.id)));
    if (r.achados.length) { setEscolhidos((l) => [...l, ...r.achados]); mudou(); }
    setRelatorioLista(r);
    setLista("");
  };
  const lerArquivo = async (f: File) => {
    try {
      const linhas = await lerPlanilhaXlsx(await f.arrayBuffer());
      const cab = (linhas[0] ?? []).map(normalizarTexto);
      const col = Math.max(cab.indexOf("codigo"), cab.indexOf("nome"));
      adicionarLista(linhas.slice(col >= 0 ? 1 : 0).map((l) => l[col >= 0 ? col : 0] ?? "").filter(Boolean));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível ler a planilha."); }
  };

  /** Mede o km real dos carros em segundo plano; o plano já está na tela com o km estimado. */
  const medirKm = async (p: Plano, versao: number) => {
    const lotes = em<{ c: Carro; i: number }>(p.carros.map((c, i) => ({ c, i })), LOTE_KM);
    let feitos = 0;
    for (const parte of lotes) {
      if (versaoPlano.current !== versao) return;
      try {
        const r = await chamarApi<{ km: ({ km: number; estimado: boolean } | null)[] }>("/api/extras/km", { unidade_id: p.unidade.id, sentido: p.sentido, carros: parte.map(({ c }) => c.pessoas.map((x) => x.id)) });
        if (versaoPlano.current !== versao) return;
        setPlano((atual) => {
          if (!atual || versaoPlano.current !== versao) return atual;
          const carros = atual.carros.map((c, i) => { const k = r.km[parte.findIndex((x) => x.i === i)]; return k ? { ...c, km: k.km, km_estimado: k.estimado } : c; });
          const kmTotal = Math.round(carros.reduce((s, c) => s + (c.km ?? 0), 0) * 10) / 10;
          return { ...atual, carros, resumo: { ...atual.resumo, km: kmTotal } };
        });
      } catch { /* o km estimado continua valendo */ }
      feitos += parte.length;
      setMedindo(`Medindo o km real: ${feitos} de ${p.carros.length} carros…`);
    }
    if (versaoPlano.current === versao) setMedindo("");
  };

  const roteirizar = async () => {
    setErro(""); setGeradas(null);
    if (!unidadeId) { setErro("Escolha a unidade da empresa."); return; }
    if (!escolhidos.length) { setErro("Adicione pelo menos um colaborador."); return; }
    setOcupado("planejar");
    const versao = ++versaoPlano.current;
    try {
      // 1) Acha as casas no mapa, em lotes (quem já foi localizado nos últimos 30 dias não é buscado de novo)
      const comCidade = escolhidos.filter((c) => c.cidade);
      let feitos = 0;
      for (const parte of em(comCidade.map((c) => c.id), LOTE_LOCALIZAR)) {
        setProgresso(`Localizando endereços: ${feitos} de ${comCidade.length}…`);
        await chamarApi("/api/extras/localizar", { ids: parte });
        feitos += parte.length;
        if (versaoPlano.current !== versao) return;
      }
      // 2) Agrupa
      setProgresso("Agrupando nos menos carros…");
      const p = await chamarApi<Plano>("/api/extras/planejar", { colaboradores: escolhidos.map((c) => c.id), sentido, unidade_id: unidadeId, veiculo_maximo: veiculoMaximo });
      if (versaoPlano.current !== versao) return;
      setPlano(p); setLote(crypto.randomUUID());
      setMedindo(`Medindo o km real: 0 de ${p.carros.length} carros…`);
      void medirKm(p, versao);
    } catch (e) { setPlano(null); setErro(e instanceof Error ? e.message : "Não foi possível roteirizar."); }
    finally { setOcupado(""); setProgresso(""); }
  };

  const gerar = async () => {
    if (!plano) return;
    if (!quando) { setErro("Informe a data e hora da extra."); return; }
    if (!solicitanteId) { setErro("Escolha a pessoa autorizada que responde por esta extra."); return; }
    const hora = new Date(quando);
    if (!(await confirmar({
      titulo: `Gerar ${plano.carros.length} corrida(s) de extra?`,
      texto: `${plano.resumo.passageiros} colaborador(es), ${hora.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Cada carro vira uma corrida enviada ao fornecedor mais barato do trecho; os fornecedores recebem as mensagens na hora.`,
      confirmar: "Gerar e enviar",
    }))) return;
    setOcupado("gerar"); setErro("");
    const feitas: Gerada[] = [];
    try {
      // Em lotes: cada corrida consulta o mapa para o preço. Se algo falhar no meio, clicar de novo continua de onde parou (mesmo lote).
      for (const parte of em<{ c: Carro; i: number }>(plano.carros.map((c, i) => ({ c, i })), LOTE_GERAR)) {
        setProgresso(`Gerando corridas: ${feitas.length} de ${plano.carros.length}…`);
        const r = await chamarApi<{ corridas: Gerada[] }>("/api/extras/gerar", {
          lote, sentido: plano.sentido, unidade_id: plano.unidade.id, solicitante_id: solicitanteId, data_hora: hora.toISOString(),
          inicio: parte[0].i, total: plano.carros.length, carros: parte.map(({ c }) => c.pessoas.map((p) => p.id)),
        });
        feitas.push(...r.corridas);
        setGeradas([...feitas]);
      }
      avisar(`${feitas.length} corrida(s) de extra criada(s).`);
    } catch (e) {
      setGeradas(feitas.length ? [...feitas] : null);
      setErro(`${e instanceof Error ? e.message : "Não foi possível gerar as corridas."}${feitas.length ? ` Foram criadas ${feitas.length} de ${plano.carros.length}; clique em gerar de novo para continuar de onde parou.` : ""}`);
    } finally { setOcupado(""); setProgresso(""); }
  };

  const semEndereco = escolhidos.filter((c) => !c.cidade).length;
  const terminou = !!geradas && !!plano && geradas.length >= plano.carros.length;

  return (
    <>
      <TopoPagina titulo="Extras" subtitulo="Monte a lista de colaboradores da hora extra. O app puxa o endereço de cada um, junta nos menos carros possíveis (menor custo, depois menos carros, depois menos km) e gera as corridas." />
      {erroCarga && <div className="err">{erroCarga}</div>}

      <section className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          <Campo rotulo="Sentido">
            <select value={sentido} onChange={(e) => { setSentido(e.target.value as "saida" | "entrada"); mudou(); }}>
              <option value="saida">Saída: empresa → casa (depois da extra)</option>
              <option value="entrada">Entrada: casa → empresa (antes da extra)</option>
            </select>
          </Campo>
          <Campo rotulo="Data e hora da corrida"><input type="datetime-local" value={quando} onChange={(e) => { setQuando(e.target.value); setGeradas(null); }} /></Campo>
          <Campo rotulo="Unidade da empresa">
            <select value={unidadeId} onChange={(e) => { setUnidadeId(e.target.value); mudou(); }}>
              <option value="">Escolha…</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Maior veículo permitido" ajuda="O app só junta mais gente num carro até este limite (até 10 endereços diferentes por carro).">
            <select value={veiculoMaximo} onChange={(e) => { setVeiculoMaximo(e.target.value); mudou(); }}>
              {VEICULOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Pessoa autorizada responsável" ajuda="As corridas saem no nome dela.">
            <select value={solicitanteId} onChange={(e) => { setSolicitanteId(e.target.value); setGeradas(null); }}>
              <option value="">Escolha…</option>
              {solicitantes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Campo>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Colaboradores da extra <Badge>{escolhidos.length}</Badge></h3>
        <div style={{ position: "relative", maxWidth: 520 }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o nome do colaborador…" aria-label="Buscar colaborador" style={{ width: "100%" }} autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter" && sugestoes.length === 1) { e.preventDefault(); adicionar(sugestoes[0]); } }} />
          {sugestoes.length > 0 && (
            <ul className="sugestoes" role="listbox" aria-label="Colaboradores encontrados">
              {sugestoes.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected="false" onClick={() => adicionar(c)}>
                    <strong>{c.nome}</strong>
                    <small className="bloco texto-fraco">{c.cidade ? enderecoCurto(c) : "Sem endereço no cadastro"}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca.trim().length >= 2 && !sugestoes.length && <p className="texto-fraco" style={{ margin: "6px 0 0" }}>Nenhum colaborador ativo com esse nome.</p>}
        </div>

        <details style={{ marginTop: 12 }} open={escolhidos.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Adicionar muitos de uma vez</summary>
          <p className="texto-fraco" style={{ margin: "8px 0" }}>Cole uma lista (um nome ou código por linha) ou envie uma planilha com a coluna Nome ou Código.</p>
          <textarea value={lista} onChange={(e) => setLista(e.target.value)} rows={5} style={{ width: "100%", maxWidth: 520 }} placeholder={"Maria da Silva\n15000923\nJoão Souza"} aria-label="Lista de colaboradores" />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="ghost" disabled={!lista.trim()} onClick={() => adicionarLista(linhasDaLista(lista))}>Adicionar da lista</button>
            <label className="ghost botao-arquivo">Enviar planilha (.xlsx)
              <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void lerArquivo(f); }} />
            </label>
          </div>
          {relatorioLista && (
            <div className={relatorioLista.naoAchados.length || relatorioLista.ambiguos.length ? "resumo-entrada" : "ok"} style={{ marginTop: 10 }}>
              <div>{relatorioLista.achados.length} colaborador(es) adicionado(s){relatorioLista.repetidos ? `, ${relatorioLista.repetidos} repetido(s) ignorado(s)` : ""}.</div>
              {relatorioLista.naoAchados.length > 0 && <div>Não encontrados ({relatorioLista.naoAchados.length}): {relatorioLista.naoAchados.slice(0, 15).join(", ")}{relatorioLista.naoAchados.length > 15 ? "…" : ""}</div>}
              {relatorioLista.ambiguos.length > 0 && <div>Mais de um colaborador para ({relatorioLista.ambiguos.length}): {relatorioLista.ambiguos.slice(0, 10).map((a) => a.texto).join(", ")}{relatorioLista.ambiguos.length > 10 ? "…" : ""}. Escolha pelo campo de busca.</div>}
            </div>
          )}
        </details>

        {escolhidos.length > 0 && (
          <div className="tw" style={{ marginTop: 14, maxHeight: 360, overflow: "auto" }}>
            <table>
              <thead><tr><th>Colaborador</th><th>Endereço</th><th>Cidade / UF</th><th>Bairro</th><th /></tr></thead>
              <tbody>{escolhidos.map((c) => (
                <tr key={c.id}>
                  <td><div className="repor-produto">{c.nome}</div><small className="texto-fraco">{c.codigo}</small></td>
                  <td>{c.endereco ?? <Badge variant="warning">Sem endereço</Badge>}</td>
                  <td>{[c.cidade, c.uf].filter(Boolean).join(" / ") || "—"}</td>
                  <td>{c.bairro ?? "—"}</td>
                  <td><button type="button" className="ghost" onClick={() => remover(c.id)}>Remover</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {semEndereco > 0 && <p className="err" style={{ marginTop: 12 }}>{semEndereco} colaborador(es) sem cidade no cadastro: importe a planilha de Ativos com endereço (Cadastros › Importação de Ativos) antes de roteirizar.</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="pri" disabled={!!ocupado || !escolhidos.length} onClick={roteirizar}>{ocupado === "planejar" ? "Roteirizando…" : "Roteirizar"}</button>
          {escolhidos.length > 0 && <button type="button" className="ghost" disabled={!!ocupado} onClick={() => { setEscolhidos([]); setRelatorioLista(null); mudou(); }}>Limpar lista</button>}
          {progresso && <span className="texto-fraco" role="status">{progresso}</span>}
        </div>
      </section>

      {erro && <div className="err" style={{ marginTop: 16 }}>{erro}</div>}

      {plano && (
        <section style={{ marginTop: 16 }}>
          <div className="kpis">
            <KpiCard value={plano.resumo.carros} label="Carros" />
            <KpiCard value={plano.resumo.passageiros} label="Colaboradores" />
            <KpiCard value={`${plano.resumo.km.toLocaleString("pt-BR")} km`} label={medindo ? "Km (estimado, medindo o real)" : "Km rodados (soma dos carros)"} />
            <KpiCard value={brl(plano.resumo.valor)} label={plano.resumo.semPreco ? `Custo (${plano.resumo.semPreco} carro(s) sem preço)` : "Custo pela tabela"} alert={plano.resumo.semPreco > 0} />
          </div>
          {medindo && <p className="texto-fraco" role="status" style={{ margin: "0 0 12px" }}>{medindo}</p>}
          {plano.avisos.length > 0 && <div className="resumo-entrada" style={{ marginBottom: 14 }}>{plano.avisos.map((a) => <div key={a}>{a}</div>)}</div>}

          {plano.carros.map((c, i) => (
            <details className="card" key={i} style={{ marginBottom: 10 }} open={plano.carros.length <= 8}>
              <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span><strong>Carro {i + 1}</strong> <Badge>{ROTULO_VEICULO[c.veiculo] ?? c.veiculo} · {c.passageiros} pessoa(s) · {c.paradas} parada(s)</Badge></span>
                <span className="texto-fraco">
                  {c.km != null ? `${c.km.toLocaleString("pt-BR")} km${c.km_estimado ? " (estimado)" : ""}` : "km não calculado"} · {c.valor != null ? <strong>{brl(c.valor)}</strong> : <Badge variant="warning">Sem preço na tabela</Badge>}
                  {c.fornecedor && <> · {c.fornecedor}</>}
                </span>
              </summary>
              <small className="bloco texto-fraco" style={{ marginTop: 8 }}>
                {c.cidades.length > 0 && <>Cidades: {c.cidades.join(", ")}</>}
                {c.preco_por && <> · Preço definido por {c.preco_por} (destino mais caro)</>}
              </small>
              {c.km != null && !c.km_estimado && c.paradas > 0 && (() => {
                const est = c.km_est;
                return est != null && c.km > est * 1.8 && c.km - est > 10
                  ? <p className="err" style={{ marginTop: 8 }}>Atenção: o km real ({c.km.toLocaleString("pt-BR")} km) ficou bem acima do estimado ({est.toLocaleString("pt-BR")} km). Confira os endereços deste carro.</p>
                  : null;
              })()}
              <ol style={{ margin: "12px 0 0", paddingLeft: 20 }}>
                <li className="texto-fraco">{plano.sentido === "saida" ? `Sai de ${plano.unidade.nome}` : `Chega em ${plano.unidade.nome} no fim do percurso`}</li>
                {c.pessoas.map((p) => (
                  <li key={p.id}><strong>{p.nome}</strong> <span className="texto-fraco">· {[p.bairro, [p.cidade, p.uf].filter(Boolean).join("/")].filter(Boolean).join(", ")}{p.localizacao !== "endereço" ? ` (${p.localizacao})` : ""}</span></li>
                ))}
              </ol>
              {c.descricao_preco && <p className="texto-fraco" style={{ margin: "8px 0 0", fontSize: 13 }}>Preço da tabela: {c.descricao_preco}</p>}
            </details>
          ))}

          {!terminou && (
            <div className="row">
              <button type="button" className="pri" disabled={!!ocupado} onClick={gerar}>{ocupado === "gerar" ? "Gerando…" : geradas?.length ? `Continuar: gerar as ${plano.carros.length - geradas.length} corridas que faltam` : `Gerar ${plano.carros.length} corrida(s) e enviar aos fornecedores`}</button>
              <span className="texto-fraco" style={{ fontSize: 13 }}>Informe antes a data e hora e a pessoa responsável. As corridas seguem o fluxo normal, inclusive a aprovação do planejamento.</span>
            </div>
          )}
        </section>
      )}

      {geradas && geradas.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Corridas criadas <Badge>{geradas.length}</Badge></h3>
          <div className="tw" style={{ maxHeight: 420, overflow: "auto" }}>
            <table>
              <thead><tr><th>Protocolo</th><th>Pessoas</th><th>Fornecedor</th><th /></tr></thead>
              <tbody>{geradas.map((g) => (
                <tr key={g.protocolo}>
                  <td className="protocolo">{g.protocolo}</td><td>{g.passageiros}</td>
                  <td>{g.fornecedor ?? "—"}{g.aviso && <small className="bloco texto-fraco">{g.aviso}</small>}</td>
                  <td>{g.whatsapp && <a className="botao-whatsapp" style={{ margin: 0 }} href={g.whatsapp} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p style={{ margin: "12px 0 0" }}><Link href="/corridas">Ver em Corridas</Link></p>
        </section>
      )}
    </>
  );
}
