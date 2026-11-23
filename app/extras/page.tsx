"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { brl } from "@/lib/datas";
import { Badge, KpiCard } from "@/components/UI";
import { Campo, TopoPagina, normalizarTexto } from "@/components/Formulario";
import { useRetorno } from "@/components/Retorno";

type Colab = { id: string; codigo: string; nome: string; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };
type Opcao = { id: string; nome: string };
type Pessoa = { id: string; nome: string; endereco: string; bairro: string | null; cidade: string | null; uf: string | null; localizacao: string };
type Carro = {
  passageiros: number; paradas: number; veiculo: string; km: number | null; km_estimado: boolean; valor: number | null; fornecedor: string | null;
  descricao_preco: string | null; sem_preco: boolean; sem_local: boolean; pessoas: Pessoa[];
};
type Plano = { unidade: { id: string; nome: string; endereco: string }; sentido: "entrada" | "saida"; carros: Carro[]; resumo: { carros: number; passageiros: number; km: number; valor: number; semPreco: number }; avisos: string[] };
type Gerada = { protocolo: string; fornecedor: string | null; passageiros: number; aviso?: string; whatsapp?: string };

const VEICULOS: [string, string][] = [["passeio", "Passeio (até 4 pessoas)"], ["spin", "Spin (até 6 pessoas)"], ["van", "Van (até 15 pessoas)"]];
const ROTULO_VEICULO: Record<string, string> = { passeio: "Passeio", spin: "Spin", van: "Van" };
const enderecoCurto = (c: Pick<Colab, "endereco" | "bairro" | "cidade" | "uf">) =>
  [c.endereco, c.bairro, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");

export default function Extras() {
  const { confirmar, avisar } = useRetorno();
  const [colabs, setColabs] = useState<Colab[]>([]);
  const [unidades, setUnidades] = useState<Opcao[]>([]);
  const [solicitantes, setSolicitantes] = useState<Opcao[]>([]);
  const [erroCarga, setErroCarga] = useState("");
  const [escolhidos, setEscolhidos] = useState<Colab[]>([]);
  const [busca, setBusca] = useState("");
  const [sentido, setSentido] = useState<"saida" | "entrada">("saida");
  const [quando, setQuando] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [solicitanteId, setSolicitanteId] = useState("");
  const [veiculoMaximo, setVeiculoMaximo] = useState("spin");
  const [plano, setPlano] = useState<Plano | null>(null);
  const [lote, setLote] = useState("");
  const [ocupado, setOcupado] = useState<"" | "planejar" | "gerar">("");
  const [erro, setErro] = useState("");
  const [geradas, setGeradas] = useState<Gerada[] | null>(null);

  useEffect(() => {
    (async () => {
      const [c, u, s] = await Promise.all([
        supabase.from("colaboradores").select("id,codigo,nome,endereco,bairro,cidade,uf,cep").eq("ativo", true).order("nome").limit(5000),
        supabase.from("unidades").select("id,nome").eq("ativo", true).order("nome"),
        supabase.from("solicitantes").select("id,nome").eq("ativo", true).order("nome"),
      ]);
      if (c.error) {
        setErroCarga(/does not exist|could not find the table|schema cache/i.test(c.error.message)
          ? "O banco ainda não tem o cadastro de colaboradores. Rode supabase/023_colaboradores.sql e 024_colaboradores_endereco.sql no SQL Editor do Supabase e recarregue a página."
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

  const mudou = () => { setPlano(null); setGeradas(null); setErro(""); };
  const adicionar = (c: Colab) => { setEscolhidos((l) => [...l, c]); setBusca(""); mudou(); };
  const remover = (id: string) => { setEscolhidos((l) => l.filter((c) => c.id !== id)); mudou(); };

  const roteirizar = async () => {
    setErro(""); setGeradas(null);
    if (!unidadeId) { setErro("Escolha a unidade da empresa."); return; }
    if (!escolhidos.length) { setErro("Adicione pelo menos um colaborador."); return; }
    setOcupado("planejar");
    try {
      const p = await chamarApi<Plano>("/api/extras/planejar", { colaboradores: escolhidos.map((c) => c.id), sentido, unidade_id: unidadeId, veiculo_maximo: veiculoMaximo });
      setPlano(p); setLote(crypto.randomUUID());
    } catch (e) { setPlano(null); setErro(e instanceof Error ? e.message : "Não foi possível roteirizar."); }
    finally { setOcupado(""); }
  };

  const gerar = async () => {
    if (!plano) return;
    if (!quando) { setErro("Informe a data e hora da extra."); return; }
    if (!solicitanteId) { setErro("Escolha a pessoa autorizada que responde por esta extra."); return; }
    const hora = new Date(quando);
    if (!(await confirmar({
      titulo: `Gerar ${plano.carros.length} corrida(s) de extra?`,
      texto: `${plano.resumo.passageiros} colaborador(es), ${hora.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Cada carro vai ao fornecedor mais barato do trecho.`,
      confirmar: "Gerar e enviar",
    }))) return;
    setOcupado("gerar"); setErro("");
    try {
      const r = await chamarApi<{ corridas: Gerada[] }>("/api/extras/gerar", {
        lote, sentido: plano.sentido, unidade_id: plano.unidade.id, solicitante_id: solicitanteId, data_hora: hora.toISOString(),
        carros: plano.carros.map((c) => c.pessoas.map((p) => p.id)),
      });
      setGeradas(r.corridas); avisar(`${r.corridas.length} corrida(s) de extra criada(s).`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível gerar as corridas."); }
    finally { setOcupado(""); }
  };

  const semEndereco = escolhidos.filter((c) => !c.cidade).length;

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
          <Campo rotulo="Maior veículo permitido" ajuda="O app só junta mais gente num carro até este limite.">
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

        {escolhidos.length > 0 && (
          <div className="tw" style={{ marginTop: 14 }}>
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
          {escolhidos.length > 0 && <button type="button" className="ghost" disabled={!!ocupado} onClick={() => { setEscolhidos([]); mudou(); }}>Limpar lista</button>}
        </div>
      </section>

      {erro && <div className="err" style={{ marginTop: 16 }}>{erro}</div>}

      {plano && (
        <section style={{ marginTop: 16 }}>
          <div className="kpis">
            <KpiCard value={plano.resumo.carros} label="Carros" />
            <KpiCard value={plano.resumo.passageiros} label="Colaboradores" />
            <KpiCard value={`${plano.resumo.km.toLocaleString("pt-BR")} km`} label="Km rodados (soma dos carros)" />
            <KpiCard value={brl(plano.resumo.valor)} label={plano.resumo.semPreco ? `Custo (${plano.resumo.semPreco} sem preço)` : "Custo pela tabela"} alert={plano.resumo.semPreco > 0} />
          </div>
          {plano.avisos.length > 0 && <div className="resumo-entrada" style={{ marginBottom: 14 }}>{plano.avisos.map((a) => <div key={a}>{a}</div>)}</div>}

          {plano.carros.map((c, i) => (
            <div className="card" key={i} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Carro {i + 1} <Badge>{ROTULO_VEICULO[c.veiculo] ?? c.veiculo} · {c.passageiros} pessoa(s)</Badge></h3>
                <div className="texto-fraco">
                  {c.km != null ? `${c.km.toLocaleString("pt-BR")} km${c.km_estimado ? " (estimado)" : ""}` : "km não calculado"} · {c.valor != null ? <strong>{brl(c.valor)}</strong> : <Badge variant="warning">Sem preço na tabela</Badge>}
                  {c.fornecedor && <> · {c.fornecedor}</>}
                </div>
              </div>
              <ol style={{ margin: "12px 0 0", paddingLeft: 20 }}>
                <li className="texto-fraco">{plano.sentido === "saida" ? `Sai de ${plano.unidade.nome}` : `Chega em ${plano.unidade.nome} no fim do percurso`}</li>
                {c.pessoas.map((p) => (
                  <li key={p.id}><strong>{p.nome}</strong> <span className="texto-fraco">· {[p.bairro, [p.cidade, p.uf].filter(Boolean).join("/")].filter(Boolean).join(", ")}{p.localizacao !== "endereço" ? ` (${p.localizacao})` : ""}</span></li>
                ))}
              </ol>
              {c.descricao_preco && <p className="texto-fraco" style={{ margin: "8px 0 0", fontSize: 13 }}>Preço da tabela: {c.descricao_preco}</p>}
            </div>
          ))}

          {!geradas && (
            <div className="row">
              <button type="button" className="pri" disabled={!!ocupado} onClick={gerar}>{ocupado === "gerar" ? "Gerando…" : `Gerar ${plano.carros.length} corrida(s) e enviar aos fornecedores`}</button>
              <span className="texto-fraco" style={{ fontSize: 13 }}>Informe antes a data e hora e a pessoa responsável. As corridas seguem o fluxo normal, inclusive a aprovação do planejamento.</span>
            </div>
          )}
        </section>
      )}

      {geradas && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Corridas criadas</h3>
          <div className="tw">
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
