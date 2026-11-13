"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import Prazo from "@/components/Prazo";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";
import NotificacoesPush from "@/components/NotificacoesPush";
import LoginFornecedor from "@/components/LoginFornecedor";
import { baixarXlsx } from "@/lib/xlsx";
import { dataSP, partesSP } from "@/lib/datas";

const isoDia = (d: Date) => { const p = partesSP(d); return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`; };
type Linha = { protocolo: string; data: string; hora: string; tipo: string; status: string; solicitante: string; setor: string | null; origem: string; destino: string; passageiros: number; motorista: string | null; placa: string | null; valor: number | null; observacoes: string | null };

const LOGIN = "__login__";

/** Gera a planilha Excel com as corridas atribuídas ao fornecedor no período. Devolve a mensagem para a tela. */
async function baixarCorridas(token: string, de: string, ate: string): Promise<string> {
  const r = await fetch(`/api/portal/exportar?token=${token}&de=${de}&ate=${ate}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) return LOGIN;
  if (!r.ok) return j.erro ?? "Não foi possível gerar a planilha.";
  const linhas: Linha[] = j.corridas ?? [];
  if (!linhas.length) return "Nenhuma corrida atribuída a vocês nesse período.";
  baixarXlsx(`corridas-${de}-a-${ate}.xlsx`, "Corridas", [
    { titulo: "Protocolo", largura: 16 }, { titulo: "Data", largura: 11 }, { titulo: "Hora", largura: 7 }, { titulo: "Tipo", largura: 10 },
    { titulo: "Status", largura: 16 }, { titulo: "Solicitante", largura: 24 }, { titulo: "Setor", largura: 16 },
    { titulo: "Origem", largura: 36 }, { titulo: "Destino", largura: 36 }, { titulo: "Passageiros", formato: "inteiro", largura: 11 },
    { titulo: "Motorista", largura: 20 }, { titulo: "Placa", largura: 10 }, { titulo: "Valor informado", formato: "moeda", largura: 15 },
    { titulo: "Observações", largura: 36 },
  ], linhas.map((c) => [c.protocolo, c.data, c.hora, c.tipo, c.status, c.solicitante, c.setor, c.origem, c.destino, c.passageiros, c.motorista, c.placa, c.valor, c.observacoes]));
  return `${linhas.length} corrida${linhas.length > 1 ? "s" : ""} na planilha.${j.truncado ? " O período tem mais corridas que o limite de uma planilha; escolha um intervalo menor para ver todas." : ""}`;
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

type Item = { protocolo: string; status: string; status_rotulo: string; quando: string; origem: string; destino: string; solicitante: string; valor: string | null; link: string; prazo_iso: string | null; observacoes?: string | null };
type Dados = { fornecedor: string; responder: Item[]; em_curso: Item[]; encerradas: Item[]; qtd_encerradas?: number; total_periodo: string; qtd_concluidas?: number };

/** Portal fixo do fornecedor: corridas para responder, em andamento e encerradas, cada uma com o link de ação. */
export default function Portal() {
  const { token } = useParams<{ token: string }>();
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [login, setLogin] = useState(false);
  const [de, setDe] = useState(() => { const h = partesSP(new Date()); return isoDia(dataSP(h.ano, h.mes, 1)); });
  const [ate, setAte] = useState(() => isoDia(new Date()));
  const [periodo, setPeriodo] = useState<{ de: string; ate: string } | null>(null);
  const [aviso, setAviso] = useState("");
  const [baixando, setBaixando] = useState(false);
  const carregar = async () => {
    const r = await fetch(`/api/portal?token=${token}&de=${de}&ate=${ate}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.login) { setLogin(true); setD(null); return; }
    if (r.status === 400) { setAviso(j.erro ?? "Período inválido."); return; }
    if (!r.ok) { setErro(j.erro ?? "Não foi possível abrir o portal."); return; }
    setLogin(false); setAviso(""); setD(j); setPeriodo({ de, ate });
  };
  useEffect(() => { void carregar(); }, [token, de, ate]);
  const baixar = async () => {
    setAviso(""); setBaixando(true);
    try {
      const m = await baixarCorridas(token, de, ate);
      if (m === LOGIN) { setLogin(true); setD(null); } else setAviso(m);
    } finally { setBaixando(false); }
  };
  useIntervaloVisivel(() => void carregar(), 30_000, !login);
  const sair = async () => {
    await fetch(`/api/portal/entrar?token=${token}`, { method: "DELETE" }).catch(() => null);
    setD(null); setLogin(true);
  };

  const lista = (titulo: string, itens: Item[], vazio: string, destaque = false, total = itens.length) => (
    <section style={{ marginBottom: 20 }}>
      <h3>{titulo} <span className="texto-fraco">({total})</span></h3>
      {itens.length ? <div className="minhas-corridas">
        {itens.map((c) => (
          <Link key={c.protocolo} href={c.link} className="minha-corrida" style={{ textDecoration: "none", borderColor: destaque ? "var(--gold)" : undefined }}>
            <div className="minha-corrida-topo"><span className="protocolo">{c.protocolo}</span><span className={`tag st-${c.status}`}>{c.status_rotulo}</span></div>
            <p>{c.quando} · {c.solicitante}</p>
            <p className="texto-fraco">{c.origem} → {c.destino}</p>
            {c.observacoes && <p className="observacoes-corrida">Obs.: {c.observacoes}</p>}
            {c.prazo_iso && ["enviada", "sem_resposta"].includes(c.status) && <Prazo ate={c.prazo_iso} />}
            {c.valor && <p><strong>{c.valor}</strong></p>}
          </Link>
        ))}
      </div> : <p className="empty">{vazio}</p>}
    </section>
  );

  return (
    <div className="publico">
      <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Portal do fornecedor</strong>{d && <small>{d.fornecedor}</small>}</div>{d && <button type="button" className="ghost" style={{ marginLeft: "auto" }} onClick={sair}>Sair</button>}</div></header>
      <main className="publico-corpo">
        {erro ? <section className="card"><h2>Link indisponível</h2><p className="err">{erro}</p></section> : login ? <LoginFornecedor token={token} onEntrou={() => { setLogin(false); void carregar(); }} /> : !d ? <p className="empty">Carregando…</p> : <>
          <NotificacoesPush tipo="fornecedor" token={token} />
          <section className="card" style={{ marginBottom: 20 }}>
            <div className="filtros-corridas" style={{ marginBottom: 0, alignItems: "flex-end" }}>
              <label>De<input type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
              <label>Até<input type="date" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
              <button className="pri" onClick={baixar} disabled={baixando}>{baixando ? "Gerando…" : "Baixar planilha"}</button>
            </div>
            <p className="pagina-sub" style={{ margin: "12px 0 0" }}>
              Toque numa corrida para aceitar, recusar, registrar o embarque ou informar o valor.
              {periodo && <> Valor concluído {periodo.de === periodo.ate ? <>em {dataBR(periodo.de)}</> : <>de {dataBR(periodo.de)} a {dataBR(periodo.ate)}</>}: <strong>{d.total_periodo}</strong>{d.qtd_concluidas != null && <> ({d.qtd_concluidas} corrida{d.qtd_concluidas === 1 ? "" : "s"})</>}.</>}
            </p>
            {aviso && <p className="texto-fraco" style={{ marginTop: 8 }}>{aviso}</p>}
          </section>
          {lista("Para responder", d.responder, "Nenhuma corrida esperando resposta.", true)}
          {lista("Em andamento", d.em_curso, "Nenhuma corrida em andamento.")}
          {lista("Encerradas no período", d.encerradas, "Nenhuma corrida encerrada no período escolhido.", false, d.qtd_encerradas)}
          {(d.qtd_encerradas ?? 0) > d.encerradas.length && <p className="texto-fraco">Mostrando as {d.encerradas.length} mais recentes. Baixe a planilha para ver todas.</p>}
        </>}
      </main>
    </div>
  );
}
