"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import Prazo from "@/components/Prazo";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";

type Item = { protocolo: string; status: string; status_rotulo: string; quando: string; origem: string; destino: string; solicitante: string; valor: string | null; link: string; prazo_iso: string | null };
type Dados = { fornecedor: string; responder: Item[]; em_curso: Item[]; encerradas: Item[]; total_periodo: string };

/** Portal fixo do fornecedor: corridas para responder, em andamento e encerradas, cada uma com o link de ação. */
export default function Portal() {
  const { token } = useParams<{ token: string }>();
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const carregar = async () => {
    const r = await fetch(`/api/portal?token=${token}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.erro ?? "Não foi possível abrir o portal."); return; }
    setD(j);
  };
  useEffect(() => { void carregar(); }, [token]);
  useIntervaloVisivel(() => void carregar(), 30_000);

  const lista = (titulo: string, itens: Item[], vazio: string, destaque = false) => (
    <section style={{ marginBottom: 20 }}>
      <h3>{titulo} <span className="texto-fraco">({itens.length})</span></h3>
      {itens.length ? <div className="minhas-corridas">
        {itens.map((c) => (
          <Link key={c.protocolo} href={c.link} className="minha-corrida" style={{ textDecoration: "none", borderColor: destaque ? "var(--gold)" : undefined }}>
            <div className="minha-corrida-topo"><span className="protocolo">{c.protocolo}</span><span className={`tag st-${c.status}`}>{c.status_rotulo}</span></div>
            <p>{c.quando} · {c.solicitante}</p>
            <p className="texto-fraco">{c.origem} → {c.destino}</p>
            {c.prazo_iso && <Prazo ate={c.prazo_iso} />}
            {c.valor && <p><strong>{c.valor}</strong></p>}
          </Link>
        ))}
      </div> : <p className="empty">{vazio}</p>}
    </section>
  );

  return (
    <div className="publico">
      <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Portal do fornecedor</strong>{d && <small>{d.fornecedor}</small>}</div></div></header>
      <main className="publico-corpo">
        {erro ? <section className="card"><h2>Link indisponível</h2><p className="err">{erro}</p></section> : !d ? <p className="empty">Carregando…</p> : <>
          <p className="pagina-sub" style={{ marginBottom: 16 }}>Toque numa corrida para aceitar, recusar, registrar o embarque ou informar o valor. Valor concluído nos últimos 45 dias: <strong>{d.total_periodo}</strong>.</p>
          {lista("Para responder", d.responder, "Nenhuma corrida esperando resposta.", true)}
          {lista("Em andamento", d.em_curso, "Nenhuma corrida em andamento.")}
          {lista("Encerradas", d.encerradas, "Nenhuma corrida encerrada nos últimos 45 dias.")}
        </>}
      </main>
    </div>
  );
}
