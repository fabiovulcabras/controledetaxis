"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { KpiCard } from "@/components/UI";
import { TopoPagina } from "@/components/Formulario";
import { StatusTag } from "@/components/StatusTag";
import { useApp } from "@/components/AuthGate";
import { EXCECOES, type StatusCorrida } from "@/lib/status";
import { brl, formatarDataHora, inicioDoDiaSP, inicioDoMesSP, partesSP } from "@/lib/datas";

type Linha = {
  id: string; protocolo: string; status: StatusCorrida; data_hora_prevista: string; criado_em: string; destino: string;
  valor_informado: number | null; fornecedor_id: string | null; centro_custo_id: string | null; solicitante_id: string;
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const COM_VALOR: StatusCorrida[] = ["concluida", "validada", "contestada"];

export default function VisaoGeral() {
  const { planejamento } = useApp();
  const [mes, setMes] = useState<Linha[]>([]);
  const [excecoes, setExcecoes] = useState<Linha[]>([]);
  const [nomes, setNomes] = useState<{ forn: Record<string, string>; cc: Record<string, string>; sol: Record<string, string> }>({ forn: {}, cc: {}, sol: {} });
  const [err, setErr] = useState("");
  const [agora, setAgora] = useState(() => new Date());

  const carregar = async () => {
    const hoje = new Date();
    setAgora(hoje);
    const campos = "id,protocolo,status,data_hora_prevista,criado_em,destino,valor_informado,fornecedor_id,centro_custo_id,solicitante_id";
    const [m, ex, f, c, s] = await Promise.all([
      supabase.from("corridas").select(campos).gte("criado_em", inicioDoMesSP(hoje).toISOString()).order("criado_em", { ascending: false }).limit(2000),
      supabase.from("corridas").select(campos).in("status", EXCECOES).order("atualizado_em", { ascending: false }).limit(30),
      supabase.from("fornecedores").select("id,nome"),
      supabase.from("centros_custo").select("id,codigo,descricao"),
      supabase.from("solicitantes").select("id,nome"),
    ]);
    const erro = m.error ?? ex.error;
    setErr(erro ? `Não foi possível carregar os dados: ${erro.message}` : "");
    setMes((m.data ?? []) as Linha[]);
    setExcecoes((ex.data ?? []) as Linha[]);
    setNomes({
      forn: Object.fromEntries((f.data ?? []).map((x: any) => [x.id, x.nome])),
      cc: Object.fromEntries((c.data ?? []).map((x: any) => [x.id, `${x.codigo} · ${x.descricao}`])),
      sol: Object.fromEntries((s.data ?? []).map((x: any) => [x.id, x.nome])),
    });
  };
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(t);
  }, []);

  const resumo = useMemo(() => {
    const inicioHoje = inicioDoDiaSP(agora).getTime();
    const conta = (sts: StatusCorrida[]) => mes.filter((c) => sts.includes(c.status)).length;
    const somar = (chave: "fornecedor_id" | "centro_custo_id", mapa: Record<string, string>) => {
      const tot = new Map<string, number>();
      for (const c of mes) if (COM_VALOR.includes(c.status) && c.valor_informado != null) {
        const k = c[chave] ? mapa[c[chave]!] ?? "—" : "Sem cadastro";
        tot.set(k, (tot.get(k) ?? 0) + Number(c.valor_informado));
      }
      return [...tot.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
    };
    return {
      hoje: mes.filter((c) => new Date(c.criado_em).getTime() >= inicioHoje).length,
      aguardando: conta(["solicitada", "enviada"]),
      andamento: conta(["aceita", "em_andamento"]),
      validar: conta(["concluida"]),
      total: mes.filter((c) => COM_VALOR.includes(c.status)).reduce((s, c) => s + Number(c.valor_informado ?? 0), 0),
      porFornecedor: somar("fornecedor_id", nomes.forn),
      porCentro: somar("centro_custo_id", nomes.cc),
    };
  }, [mes, nomes, agora]);

  const p = partesSP(agora);
  const nomeMes = MESES[p.mes - 1];

  return (
    <>
      <TopoPagina titulo="Visão geral" subtitulo={`Atualizado às ${formatarDataHora(agora).slice(6)} · atualiza sozinho a cada 30 segundos`}>
        {planejamento && <Link href="/simulador" className="ghost">Simular solicitação</Link>}
      </TopoPagina>
      {err && <div className="err">{err}</div>}

      <div className="kpis">
        <KpiCard value={resumo.hoje} label="Corridas pedidas hoje" />
        <KpiCard value={resumo.aguardando} label="Aguardando fornecedor" />
        <KpiCard value={resumo.andamento} label="Aceitas ou em andamento" />
        <KpiCard value={resumo.validar} label="Concluídas a validar" />
        <KpiCard value={excecoes.length} label="Exceções para tratar" alert={excecoes.length > 0} />
      </div>

      <div className="grade-2">
        <section className="card">
          <div className="repor-topo">
            <div><h3>Exceções para tratar</h3><p className="repor-resumo">Recusas, corridas sem resposta e contestações, das mais recentes para as mais antigas.</p></div>
          </div>
          {excecoes.length ? (
            <ul className="excecoes">
              {excecoes.map((c) => (
                <li key={c.id}>
                  <span className={`sev${c.status === "contestada" ? " aviso" : ""}`} />
                  <div className="texto">
                    <span className="protocolo">{c.protocolo}</span> <StatusTag status={c.status} />
                    <div>{nomes.sol[c.solicitante_id] ?? "—"} · {c.destino}</div>
                    <small>{c.fornecedor_id ? nomes.forn[c.fornecedor_id] : "Sem fornecedor"} · {formatarDataHora(c.data_hora_prevista)}</small>
                  </div>
                  <Link className="ghost" href={`/corridas?id=${c.id}`}>Abrir</Link>
                </li>
              ))}
            </ul>
          ) : <p className="empty">Nenhuma exceção aberta.</p>}
        </section>

        <div>
          <section className="card">
            <div className="repor-topo"><div><h3>Valor informado por fornecedor</h3><p className="repor-resumo">Corridas concluídas em {nomeMes}: <strong>{brl(resumo.total)}</strong></p></div></div>
            <Barras dados={resumo.porFornecedor} vazio={`Nenhuma corrida concluída em ${nomeMes}.`} />
          </section>
          <section className="card">
            <div className="repor-topo"><div><h3>Valor por centro de custo</h3><p className="repor-resumo">Mesmo período, pelo valor que o fornecedor informou.</p></div></div>
            <Barras dados={resumo.porCentro} vazio={`Nenhuma corrida concluída em ${nomeMes}.`} />
          </section>
        </div>
      </div>
    </>
  );
}

function Barras({ dados, vazio }: { dados: { nome: string; valor: number }[]; vazio: string }) {
  if (!dados.length) return <p className="empty">{vazio}</p>;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return (
    <div className="barras">
      {dados.map((d) => (
        <div key={d.nome} className="barra-linha">
          <span title={d.nome}>{d.nome}</span>
          <div className="cobertura-trilho"><div className="cobertura-barra" style={{ width: `${(d.valor / max) * 100}%`, background: "var(--gold)" }} /></div>
          <b>{brl(d.valor)}</b>
        </div>
      ))}
    </div>
  );
}
