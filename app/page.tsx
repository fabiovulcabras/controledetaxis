"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { KpiCard } from "@/components/UI";
import { TopoPagina } from "@/components/Formulario";
import { StatusTag } from "@/components/StatusTag";
import Prazo from "@/components/Prazo";
import Barras from "@/components/Barras";
import { useApp } from "@/components/AuthGate";
import { useAlertas } from "@/components/AlertasPlanejamento";
import { useTempoReal } from "@/lib/hooks/useTempoReal";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";
import { EXCECOES, type StatusCorrida } from "@/lib/status";
import { brl, dataSP, formatarDataHora, partesSP } from "@/lib/datas";

type Linha = {
  id: string; protocolo: string; status: StatusCorrida; data_hora_prevista: string; destino: string; prazo_resposta_em: string | null;
  solicitante_nome: string; fornecedor_nome: string | null;
};
type Resumo = {
  por_status: Record<string, number>; total: number; valor_total: number;
  por_dia: { dia: string; qtd: number; valor: number }[];
  por_solicitante: { nome: string; qtd: number; valor: number }[];
  por_fornecedor: { nome: string; qtd: number; valor: number }[];
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const CAMPOS = "id,protocolo,status,data_hora_prevista,destino,prazo_resposta_em,solicitante_nome,fornecedor_nome";

export default function VisaoGeral() {
  const { planejamento } = useApp();
  const { permissao, pedirPermissao } = useAlertas();
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [hoje, setHoje] = useState(0);
  const [excecoes, setExcecoes] = useState<Linha[]>([]);
  const [aguardando, setAguardando] = useState<Linha[]>([]);
  const [err, setErr] = useState("");
  const [agora, setAgora] = useState(() => new Date());

  const carregar = async () => {
    const t = new Date();
    setAgora(t);
    const p = partesSP(t);
    const inicioMes = dataSP(p.ano, p.mes, 1), fimMes = dataSP(p.mes === 12 ? p.ano + 1 : p.ano, p.mes === 12 ? 1 : p.mes + 1, 1);
    const inicioDia = dataSP(p.ano, p.mes, p.dia);
    const [r, h, ex, ag] = await Promise.all([
      supabase.rpc("fn_resumo_periodo", { p_de: inicioMes.toISOString(), p_ate: fimMes.toISOString() }),
      supabase.from("corridas").select("id", { count: "exact", head: true }).gte("criado_em", inicioDia.toISOString()),
      supabase.from("corridas_lista").select(CAMPOS).in("status", EXCECOES).order("atualizado_em", { ascending: false }).limit(30),
      supabase.from("corridas_lista").select(CAMPOS).in("status", ["solicitada", "enviada"]).order("prazo_resposta_em", { ascending: true, nullsFirst: false }).limit(15),
    ]);
    const erro = r.error ?? ex.error ?? ag.error;
    setErr(erro ? `Não foi possível carregar os dados: ${erro.message}${/does not exist|could not find/i.test(erro.message) ? " — rode a migração supabase/003_melhorias.sql." : ""}` : "");
    setResumo((r.data as Resumo) ?? null);
    setHoje(h.count ?? 0);
    setExcecoes((ex.data ?? []) as Linha[]);
    setAguardando((ag.data ?? []) as Linha[]);
  };
  useEffect(() => { void carregar(); }, []);
  useTempoReal(["corridas"], () => void carregar());
  useIntervaloVisivel(() => void carregar(), 120_000);

  const st = resumo?.por_status ?? {};
  const soma = (...k: string[]) => k.reduce((n, s) => n + (st[s] ?? 0), 0);
  const nomeMes = MESES[partesSP(agora).mes - 1];

  return (
    <>
      <TopoPagina titulo="Visão geral" subtitulo={`Atualiza sozinha quando algo muda · ${formatarDataHora(agora).slice(6)}`}>
        {planejamento && permissao === "default" && <button type="button" className="ghost" onClick={pedirPermissao}>Ativar alertas no navegador</button>}
      </TopoPagina>
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={hoje} label="Corridas pedidas hoje" />
        <KpiCard value={aguardando.length} label="Aguardando fornecedor" />
        <KpiCard value={soma("aceita", "em_andamento")} label={`Aceitas ou em andamento (${nomeMes})`} />
        <KpiCard value={soma("concluida")} label="Concluídas a validar" />
        <KpiCard value={excecoes.length} label="Exceções para tratar" alert={excecoes.length > 0} />
      </div>

      <div className="grade-2">
        <div>
          <section className="card">
            <div className="repor-topo"><div><h3>Exceções para tratar</h3><p className="repor-resumo">Recusas, corridas sem resposta e contestações, das mais recentes para as mais antigas.</p></div></div>
            {excecoes.length ? (
              <ul className="excecoes">
                {excecoes.map((c) => (
                  <li key={c.id}>
                    <span className={`sev${c.status === "contestada" ? " aviso" : ""}`} />
                    <div className="texto">
                      <span className="protocolo">{c.protocolo}</span> <StatusTag status={c.status} />
                      <div>{c.solicitante_nome} · {c.destino}</div>
                      <small>{c.fornecedor_nome ?? "Sem fornecedor"} · {formatarDataHora(c.data_hora_prevista)}</small>
                    </div>
                    <Link className="ghost" href={`/corridas?id=${c.id}`}>Abrir</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">Nenhuma exceção aberta.</p>}
          </section>
          <section className="card">
            <div className="repor-topo"><div><h3>Aguardando fornecedor</h3><p className="repor-resumo">Pelo prazo de resposta, as mais urgentes primeiro.</p></div></div>
            {aguardando.length ? (
              <ul className="excecoes">
                {aguardando.map((c) => (
                  <li key={c.id}>
                    <div className="texto">
                      <span className="protocolo">{c.protocolo}</span> <Prazo ate={c.prazo_resposta_em} />
                      <div>{c.solicitante_nome} · {c.destino}</div>
                      <small>{c.fornecedor_nome ?? "Sem fornecedor"} · {formatarDataHora(c.data_hora_prevista)}</small>
                    </div>
                    <Link className="ghost" href={`/corridas?id=${c.id}`}>Abrir</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">Nenhuma corrida aguardando resposta.</p>}
          </section>
        </div>

        <div>
          <section className="card">
            <div className="repor-topo"><div><h3>Corridas por dia em {nomeMes}</h3><p className="repor-resumo">{resumo?.total ?? 0} corrida(s) · valor informado <strong>{brl(resumo?.valor_total ?? 0)}</strong></p></div></div>
            <GraficoDias dias={resumo?.por_dia ?? []} />
          </section>
          <section className="card">
            <div className="repor-topo"><div><h3>Valor por fornecedor</h3></div><Link href="/relatorios" className="link-botao">Relatórios</Link></div>
            <Barras dados={(resumo?.por_fornecedor ?? []).filter((f) => f.valor > 0)} vazio={`Nenhuma corrida concluída em ${nomeMes}.`} />
          </section>
          <section className="card">
            <div className="repor-topo"><div><h3>Valor por pessoa autorizada</h3></div></div>
            <Barras dados={(resumo?.por_solicitante ?? []).filter((c) => c.valor > 0).slice(0, 8)} vazio={`Nenhuma corrida concluída em ${nomeMes}.`} />
          </section>
        </div>
      </div>
    </>
  );
}

function GraficoDias({ dias }: { dias: { dia: string; qtd: number; valor: number }[] }) {
  if (!dias.length) return <p className="empty">Sem corridas no mês.</p>;
  const max = Math.max(...dias.map((d) => d.qtd), 1);
  return (
    <div className="grafico-mensal" role="img" aria-label="Quantidade de corridas por dia">
      {dias.map((d) => (
        <div key={d.dia} className="grafico-mes" title={`${d.dia.slice(8)}/${d.dia.slice(5, 7)}: ${d.qtd} corrida(s), ${brl(d.valor)}`}>
          <div className="grafico-barras"><div className="grafico-barra saida" style={{ height: `${(d.qtd / max) * 100}%`, width: "60%" }} /></div>
          <small>{d.dia.slice(8)}</small>
        </div>
      ))}
    </div>
  );
}
