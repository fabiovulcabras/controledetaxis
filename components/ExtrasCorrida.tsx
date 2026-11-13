"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { chamarApi } from "@/lib/api";
import { brl, formatarDataHora } from "@/lib/datas";
import { STATUS_EXTRA, TIPOS_EXTRA, type Extra } from "@/lib/extras";

type ExtraLista = Extra & { corridas?: { id: string; protocolo: string; destino: string; data_hora_prevista: string; fornecedores?: { nome: string } | null } | null };

/** Abre o comprovante numa aba nova com link temporário. */
export async function abrirArquivo(caminho: string) {
  const aba = window.open("", "_blank");
  try {
    const { url } = await chamarApi<{ url: string }>("/api/arquivos", { caminho });
    if (aba) aba.location.href = url; else window.location.href = url;
  } catch (e) {
    aba?.close();
    alert(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.");
  }
}

/**
 * Extras lançados pelo fornecedor. Com `corridaId`, os da corrida; sem ele, todos os pendentes (tela de conciliação).
 * O planejamento aprova ou recusa (com motivo) enquanto o extra não entrou num espelho.
 */
export default function ExtrasCorrida({ corridaId, podeAgir, onMudou }: { corridaId?: string; podeAgir: boolean; onMudou?: () => void }) {
  const [lista, setLista] = useState<ExtraLista[] | null>(null);
  const [semMigracao, setSemMigracao] = useState(false);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState("");

  const carregar = async () => {
    let q = supabase.from("corrida_extras").select("*, corridas(id,protocolo,destino,data_hora_prevista,fornecedores(nome))").order("criado_em");
    q = corridaId ? q.eq("corrida_id", corridaId) : q.eq("status", "pendente");
    const { data, error } = await q;
    if (error) { setSemMigracao(/corrida_extras/.test(error.message)); setLista([]); return; }
    setLista((data ?? []) as ExtraLista[]);
  };
  useEffect(() => { void carregar(); }, [corridaId]);

  const decidir = async (id: string, decisao: "aprovado" | "recusado", m?: string) => {
    setOcupado(true); setErr("");
    const { error } = await supabase.rpc("fn_decidir_extra", { p_extra: id, p_decisao: decisao, p_motivo: m ?? null });
    setOcupado(false);
    if (error) { setErr(error.message); return; }
    setRecusando(null); setMotivo("");
    await carregar(); onMudou?.();
  };

  if (lista === null) return <p className="secao-ajuda">Carregando extras…</p>;
  if (semMigracao) return <p className="secao-ajuda">Os extras precisam da migração <strong>supabase/015_espelho.sql</strong>.</p>;
  if (!lista.length) return <p className="secao-ajuda">{corridaId ? "Nenhum extra lançado pelo fornecedor." : "Nenhum extra aguardando decisão."}</p>;

  return (
    <>
      {err && <div className="err">{err}</div>}
      <ul className="lista-extras">
        {lista.map((x) => (
          <li key={x.id}>
            <div>
              <strong>{TIPOS_EXTRA[x.tipo]}</strong> · {brl(x.valor)}
              {!corridaId && x.corridas && <small className="bloco"><Link href={`/corridas?id=${x.corridas.id}`} className="link-botao">{x.corridas.protocolo}</Link> · {x.corridas.fornecedores?.nome} · {formatarDataHora(x.corridas.data_hora_prevista)} · {x.corridas.destino}</small>}
              {x.descricao && <small className="bloco texto-fraco">{x.descricao}</small>}
              <small className="bloco texto-fraco">Lançado em {formatarDataHora(x.criado_em)}</small>
              {x.comprovante && <button type="button" className="atalho" onClick={() => abrirArquivo(x.comprovante!)}>Ver comprovante</button>}
            </div>
            <div style={{ textAlign: "right", minWidth: 150 }}>
              {x.status !== "pendente" && <span className={`tag ${x.status === "aprovado" ? "aprovada" : "reprovada"}`}>{STATUS_EXTRA[x.status]}</span>}
              {x.motivo_recusa && <small className="bloco texto-fraco">{x.motivo_recusa}</small>}
              {x.espelho_id && <small className="bloco texto-fraco">No espelho do mês</small>}
              {podeAgir && !x.espelho_id && (recusando === x.id ? (
                <form className="row" onSubmit={(e) => { e.preventDefault(); void decidir(x.id, "recusado", motivo); }}>
                  <input autoFocus placeholder="Motivo da recusa" value={motivo} onChange={(e) => setMotivo(e.target.value)} required style={{ width: 150 }} />
                  <button className="danger" disabled={ocupado}>Recusar</button>
                  <button type="button" className="ghost" onClick={() => setRecusando(null)}>✕</button>
                </form>
              ) : (
                <div className="segmentos" style={{ marginTop: 6 }}>
                  {x.status !== "aprovado" && <button type="button" disabled={ocupado} onClick={() => decidir(x.id, "aprovado")}>Aprovar</button>}
                  {x.status !== "recusado" && <button type="button" disabled={ocupado} onClick={() => { setRecusando(x.id); setMotivo(""); }}>Recusar</button>}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
