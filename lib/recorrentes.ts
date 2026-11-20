import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repo, Saida } from "./bot/tipos";
import { despacharOuSegurar, escolherFornecedor, alertar, numero } from "./bot/acoes";
import { dataSP, formatarDataHora, partesSP } from "./datas";

export type Recorrente = {
  id: string; solicitante_id: string; dias_semana: number[]; hora: string;
  origem: string; origem_lat: number | null; origem_lng: number | null; destino: string; destino_lat: number | null; destino_lng: number | null;
  paradas: unknown; qtd_passageiros: number; outros_passageiros: string | null; motivo: string; observacoes: string | null;
  pular_feriados: boolean; inicio: string; fim: string | null; ultima_data: string | null; ativo: boolean;
};

const DIAS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
export const textoDias = (dias: number[]) => [...dias].sort().map((d) => DIAS[d]).join(", ");
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Próxima ocorrência da recorrência ainda não gerada, dentro da antecedência (horas), ou null.
 * Dias da semana de 1 (segunda) a 7 (domingo), no horário de São Paulo.
 */
export function proximaOcorrencia(r: Pick<Recorrente, "dias_semana" | "hora" | "inicio" | "fim" | "ultima_data" | "pular_feriados">, agora: Date,
  antecedenciaH: number, feriados: Set<string>): { data: string; quando: Date } | null {
  const [hh, mm] = r.hora.split(":").map(Number);
  const hoje = partesSP(agora);
  for (let k = 0; k <= 8; k++) {
    const base = dataSP(hoje.ano, hoje.mes, hoje.dia + k, 12, 0);
    const p = partesSP(base);
    const dia = iso(p.ano, p.mes, p.dia);
    const isoDow = p.diaSemana === 0 ? 7 : p.diaSemana;
    if (!r.dias_semana.includes(isoDow)) continue;
    if (dia < r.inicio || (r.fim && dia > r.fim) || (r.ultima_data && dia <= r.ultima_data)) continue;
    if (r.pular_feriados && feriados.has(dia)) continue;
    const quando = dataSP(p.ano, p.mes, p.dia, hh, mm || 0);
    if (quando.getTime() <= agora.getTime()) continue;
    if (quando.getTime() - agora.getTime() > antecedenciaH * 3600_000) return null;
    return { data: dia, quando };
  }
  return null;
}

/**
 * Agendador: gera as corridas recorrentes que entram na antecedência (parâmetro recorrente_antecedencia_horas)
 * e as envia ao fornecedor (ou segura para aprovação). Sem a migração 022, não faz nada.
 */
export async function gerarRecorrentes(db: SupabaseClient, repo: Repo, agora: Date): Promise<Saida[]> {
  const { data, error } = await db.from("corridas_recorrentes").select("*").eq("ativo", true).limit(200);
  if (error || !data?.length) return [];
  const antecedencia = await numero(repo, "recorrente_antecedencia_horas", 24);
  const { data: fer } = await db.from("feriados").select("data").gte("data", agora.toISOString().slice(0, 10));
  const feriados = new Set<string>((fer ?? []).map((f: { data: string }) => f.data));
  const saidas: Saida[] = [];
  for (const r of data as Recorrente[]) {
    const prox = proximaOcorrencia(r, agora, antecedencia, feriados);
    if (!prox) continue;
    // Marca antes de criar: duas execuções ao mesmo tempo não geram a mesma corrida (chave_envio também é única)
    const { data: marcou } = await db.from("corridas_recorrentes").update({ ultima_data: prox.data }).eq("id", r.id)
      .or(`ultima_data.is.null,ultima_data.lt.${prox.data}`).select("id");
    if (!marcou?.length) continue;
    const sol = await repo.solicitante(r.solicitante_id);
    if (!sol?.ativo) continue;
    try {
      const corrida = await repo.criarCorrida({
        solicitante_id: r.solicitante_id, tipo: "agendada", data_hora_prevista: prox.quando.toISOString(),
        origem: r.origem, origem_lat: r.origem_lat, origem_lng: r.origem_lng, destino: r.destino, destino_lat: r.destino_lat, destino_lng: r.destino_lng,
        ...(Array.isArray(r.paradas) && r.paradas.length ? { paradas: r.paradas as any } : {}),
        qtd_passageiros: r.qtd_passageiros, outros_passageiros: r.outros_passageiros, motivo: r.motivo,
        ...(r.observacoes ? { observacoes: r.observacoes } : {}),
        chave_envio: `rec:${r.id}:${prox.data}`, recorrente_id: r.id,
      });
      const aviso = (txt: string): Saida => ({ para: sol.telefone_whatsapp, corridaId: corrida.id, texto: txt });
      const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id, corrida);
      if (!forn) { saidas.push(...await alertar(repo, corrida, "corrida recorrente sem fornecedor ativo")); continue; }
      const d = await despacharOuSegurar(repo, corrida, forn, agora, "sistema", `Corrida recorrente enviada a ${forn.nome}`);
      saidas.push(...d.saidas, aviso(d.aprovacao
        ? `Sua corrida recorrente de ${formatarDataHora(prox.quando)} (${corrida.protocolo}) foi registrada e aguarda aprovação do planejamento (${d.aprovacao}).`
        : `Sua corrida recorrente de ${formatarDataHora(prox.quando)} (${corrida.protocolo}) foi registrada e enviada ao fornecedor ${forn.nome}. Se não precisar, cancele pelo menu.`));
    } catch (err) {
      if (!/duplicate|unique|23505/i.test(err instanceof Error ? err.message : String(err))) console.error("Corrida recorrente", r.id, err);
    }
  }
  return saidas;
}
