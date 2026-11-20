"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { useTempoReal } from "@/lib/hooks/useTempoReal";
import { useRetorno } from "@/components/Retorno";
import { formatarDataHora } from "@/lib/datas";
import { trajetoTexto } from "@/lib/multidestino";
import { ABERTAS_PARA_JUNTAR, sugestoesJuntar, type CorridaJuntar } from "@/lib/juntar";

type Linha = CorridaJuntar & { aprovacao_motivo?: string | null; solicitantes?: { nome: string } | null };

/**
 * Visão geral do planejamento: corridas que esperam aprovação (parâmetros aprovacao_*) e sugestões de juntar
 * corridas com a mesma origem e horários próximos (ainda não aceitas). Sem a migração 022, não aparece.
 */
export default function AprovacoesJuntar() {
  const { avisar, confirmar } = useRetorno();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [janela, setJanela] = useState(20);
  const [ocupado, setOcupado] = useState("");
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = async () => {
    const de = new Date(Date.now() - 3600_000).toISOString(), ate = new Date(Date.now() + 3 * 86400_000).toISOString();
    const [r, p] = await Promise.all([
      supabase.from("corridas")
        .select("id,protocolo,status,data_hora_prevista,origem,destino,origem_lat,origem_lng,qtd_passageiros,solicitante_id,paradas,juntada_em,aprovacao_status,aprovacao_motivo,solicitantes(nome)")
        .in("status", ABERTAS_PARA_JUNTAR).gte("data_hora_prevista", de).lte("data_hora_prevista", ate).order("data_hora_prevista").limit(300),
      supabase.from("parametros").select("valor").eq("chave", "juntar_janela_min").maybeSingle(),
    ]);
    if (r.error) { setLinhas(null); return; } // sem a migração 022
    setLinhas(((r.data ?? []) as any[]).map((x) => ({ ...x, solicitante_nome: x.solicitantes?.nome ?? null })));
    const j = Number(p.data?.valor); if (Number.isFinite(j) && j > 0) setJanela(j);
  };
  useEffect(() => { void carregar(); }, []);
  useTempoReal(["corridas"], () => void carregar());

  const pendentes = (linhas ?? []).filter((c) => c.status === "solicitada" && c.aprovacao_status === "pendente");
  const sugestoes = useMemo(() => sugestoesJuntar((linhas ?? []).filter((c) => c.aprovacao_status !== "pendente"), janela), [linhas, janela]);

  const agir = async (chave: string, corpo: Record<string, unknown>, ok: string) => {
    setOcupado(chave);
    try {
      await chamarApi("/api/corridas/acao", corpo);
      avisar(ok); setRecusando(null); setMotivo("");
      await carregar();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível concluir.", "erro"); }
    finally { setOcupado(""); }
  };
  const juntar = async (a: CorridaJuntar, b: CorridaJuntar) => {
    if (!(await confirmar({ titulo: `Juntar ${b.protocolo} em ${a.protocolo}?`, texto: `Os passageiros vão no mesmo carro; o destino de ${b.protocolo} vira parada (ou destino final, se for o mais longe) e ${b.protocolo} é cancelada. Os dois solicitantes e o fornecedor são avisados.`, confirmar: "Juntar" }))) return;
    await agir(`j:${a.id}`, { acao: "juntar", corridaId: a.id, outraId: b.id }, `${b.protocolo} juntada em ${a.protocolo}.`);
  };

  if (!linhas || (!pendentes.length && !sugestoes.length)) return null;
  return (
    <>
      {pendentes.length > 0 && (
        <section className="card">
          <div className="repor-topo"><div><h3>Aguardando aprovação</h3>
            <p className="repor-resumo">Corridas seguradas pelas regras de aprovação (Cadastros › Parâmetros: aprovacao_valor_acima, aprovacao_km_acima, aprovacao_fora_horario). Aprovada, vai ao fornecedor da vez.</p></div></div>
          <ul className="excecoes">
            {pendentes.map((c) => (
              <li key={c.id}>
                <span className="sev aviso" />
                <div className="texto">
                  <span className="protocolo">{c.protocolo}</span> <small>{formatarDataHora(c.data_hora_prevista)}</small>
                  <div>{c.solicitante_nome} · {c.origem} → {trajetoTexto(c)}</div>
                  <small className="negative">{c.aprovacao_motivo}</small>
                  {recusando === c.id && (
                    <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); void agir(`r:${c.id}`, { acao: "recusar_aprovacao", corridaId: c.id, obs: motivo }, `${c.protocolo} não aprovada.`); }}>
                      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (vai para o solicitante)" autoFocus style={{ flex: 1 }} />
                      <button className="danger" disabled={motivo.trim().length < 3 || !!ocupado}>Recusar</button>
                      <button type="button" className="ghost" onClick={() => setRecusando(null)}>Voltar</button>
                    </form>
                  )}
                </div>
                {recusando !== c.id && <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="pri" disabled={!!ocupado} onClick={() => void agir(`a:${c.id}`, { acao: "aprovar", corridaId: c.id }, `${c.protocolo} aprovada e enviada.`)}>{ocupado === `a:${c.id}` ? "Enviando…" : "Aprovar"}</button>
                  <button type="button" className="ghost botao-perigo" disabled={!!ocupado} onClick={() => { setRecusando(c.id); setMotivo(""); }}>Recusar</button>
                  <Link className="ghost" href={`/corridas?id=${c.id}`}>Abrir</Link>
                </div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {sugestoes.length > 0 && (
        <section className="card">
          <div className="repor-topo"><div><h3>Sugestões para juntar</h3>
            <p className="repor-resumo">Mesma origem, até {janela} min de diferença e cabem num carro comum, ainda sem aceite do fornecedor. Juntar economiza uma corrida.</p></div></div>
          <ul className="excecoes">
            {sugestoes.map((s) => (
              <li key={s.principal.id + s.outra.id}>
                <div className="texto">
                  <span className="protocolo">{s.principal.protocolo}</span> + <span className="protocolo">{s.outra.protocolo}</span> <small>{s.minutos} min de diferença · {s.passageiros} passageiros</small>
                  <div>{s.principal.origem}</div>
                  <small>{s.principal.solicitante_nome} → {s.principal.destino} ({formatarDataHora(s.principal.data_hora_prevista)}) · {s.outra.solicitante_nome} → {s.outra.destino} ({formatarDataHora(s.outra.data_hora_prevista)})</small>
                </div>
                <button type="button" className="ghost" disabled={!!ocupado} onClick={() => void juntar(s.principal, s.outra)}>{ocupado === `j:${s.principal.id}` ? "Juntando…" : "Juntar"}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
