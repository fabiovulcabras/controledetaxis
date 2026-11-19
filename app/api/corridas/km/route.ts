import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { garantirDistancia, lugaresCadastrados } from "@/lib/km-corrida";
import { RepoSupabase } from "@/lib/bot/repo-supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POR_VEZ = 12; // o plano gratuito do OpenRouteService aceita 40 rotas por minuto
const PENDENTE = "distancia_km.is.null,distancia_fonte.is.null,distancia_fonte.eq.estimada,and(preco_calculado_em.is.null,fornecedor_id.not.is.null)";

/**
 * Completa as corridas do período: distância por ruas (sem distância ou só estimada) e valor da tabela
 * (fornecedor definido e tabela ainda não calculada). Processa um lote por chamada; a tela chama de novo
 * enquanto houver "restantes". Corpo: { de, ate, fornecedorId?, concluidas?, ids?, pular?, todas?, apos? }.
 * Com `todas`, refaz o km de todas as corridas do período (ex.: depois de mudar a regra para o menor trajeto),
 * em ordem de id, continuando a partir de `apos`.
 */
export async function POST(req: Request) {
  const u = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (u instanceof Response) return u;
  const corpo = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(corpo?.ids) ? corpo.ids.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
  const de = new Date(String(corpo?.de ?? "")), ate = new Date(String(corpo?.ate ?? ""));
  if (!ids.length && (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate <= de)) return erroJson("Período inválido.");
  const pular: string[] = Array.isArray(corpo?.pular) ? corpo.pular.filter((x: unknown) => typeof x === "string").slice(0, 2000) : [];
  try {
    const db = supabaseAdmin();
    let q = db.from("corridas").select("id,origem,destino,origem_lat,origem_lng,destino_lat,destino_lng,distancia_km,distancia_fonte,fornecedor_id,preco_calculado_em");
    const todas = !ids.length && !!corpo?.todas;
    if (ids.length) q = q.in("id", ids);
    else if (todas) {
      q = q.gte("data_hora_prevista", de.toISOString()).lt("data_hora_prevista", ate.toISOString()).order("id").limit(1000);
      if (typeof corpo?.apos === "string" && corpo.apos) q = q.gt("id", corpo.apos);
      if (corpo?.fornecedorId) q = q.eq("fornecedor_id", corpo.fornecedorId);
    } else {
      q = q.gte("data_hora_prevista", de.toISOString()).lt("data_hora_prevista", ate.toISOString()).or(PENDENTE).order("data_hora_prevista").limit(1000);
      if (corpo?.concluidas) q = q.in("status", ["concluida", "validada", "contestada"]);
      if (corpo?.fornecedorId) q = q.eq("fornecedor_id", corpo.fornecedorId);
    }
    const { data, error } = await q;
    if (error) return erroJson(/distancia_fonte/.test(error.message) ? "Rode supabase/016_km.sql no Supabase." : error.message);
    const fila = (data ?? []).filter((c: any) => !pular.includes(c.id));
    const lugares = await lugaresCadastrados(db);
    const repo = new RepoSupabase(db);
    const falharam: string[] = [];
    let calculadas = 0, tabelas = 0;
    for (const c of fila.slice(0, POR_VEZ) as any[]) {
      let falhou = false;
      if (ids.length || todas || c.distancia_km == null || !c.distancia_fonte || c.distancia_fonte === "estimada") {
        const r = await garantirDistancia(db, c, true, lugares);
        if (!r || r.fonte === "estimada") falhou = true;
        if (r) calculadas++;
      }
      if (c.fornecedor_id && (ids.length || !c.preco_calculado_em)) {
        const atual = await repo.corrida(c.id);
        if (atual) {
          const copia = { ...atual, preco_calculado_em: null };
          await repo.precoTabela(copia).catch(() => null);
          if (copia.preco_calculado_em) tabelas++; else falhou = true; // fornecedor sem tabela: não tenta de novo nesta rodada
        }
      }
      if (falhou) falharam.push(c.id);
    }
    const lote = fila.slice(0, POR_VEZ) as any[];
    return Response.json({ calculadas, tabelas, falharam, restantes: Math.max(0, fila.length - POR_VEZ), apos: lote.length ? lote[lote.length - 1].id : null });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
