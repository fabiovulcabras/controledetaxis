import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { garantirDistancia, lugaresCadastrados } from "@/lib/km-corrida";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POR_VEZ = 12; // o plano gratuito do OpenRouteService aceita 40 rotas por minuto

/**
 * Calcula a distância por ruas das corridas concluídas do período que ainda não têm (ou só têm estimativa).
 * Processa um lote por chamada; a tela chama de novo enquanto houver "restantes".
 */
export async function POST(req: Request) {
  const u = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (u instanceof Response) return u;
  const corpo = await req.json().catch(() => null);
  const de = new Date(String(corpo?.de ?? "")), ate = new Date(String(corpo?.ate ?? ""));
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate <= de) return erroJson("Período inválido.");
  const pular: string[] = Array.isArray(corpo?.pular) ? corpo.pular.filter((x: unknown) => typeof x === "string").slice(0, 2000) : [];
  try {
    const db = supabaseAdmin();
    let q = db.from("corridas").select("id,origem,destino,origem_lat,origem_lng,destino_lat,destino_lng,distancia_km,distancia_fonte")
      .in("status", ["concluida", "validada", "contestada"]).gte("data_hora_prevista", de.toISOString()).lt("data_hora_prevista", ate.toISOString())
      .or("distancia_km.is.null,distancia_fonte.is.null,distancia_fonte.eq.estimada").order("data_hora_prevista").limit(500);
    if (corpo?.fornecedorId) q = q.eq("fornecedor_id", corpo.fornecedorId);
    const { data, error } = await q;
    if (error) return erroJson(/distancia_fonte/.test(error.message) ? "Rode supabase/016_km.sql no Supabase." : error.message);
    const fila = (data ?? []).filter((c: any) => !pular.includes(c.id));
    const lugares = await lugaresCadastrados(db);
    const falharam: string[] = [];
    let calculadas = 0, estimadas = 0;
    for (const c of fila.slice(0, POR_VEZ)) {
      const r = await garantirDistancia(db, c as any, true, lugares);
      if (!r) falharam.push(c.id);
      else { calculadas++; if (r.fonte === "estimada") { estimadas++; falharam.push(c.id); } }
    }
    return Response.json({ calculadas, estimadas, falharam, restantes: Math.max(0, fila.length - POR_VEZ), rota: !!process.env.ORS_API_KEY });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
