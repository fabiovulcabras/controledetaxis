import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { emParalelo, geoValida, lerColaboradores, localizarCasa } from "@/lib/extras-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const POR_CHAMADA = 25;

/**
 * Acha no mapa a casa de até 25 colaboradores e guarda as coordenadas por 30 dias (colunas lat/lng, migração 025).
 * O painel chama em lotes para listas grandes; quem já tem coordenadas válidas não é buscado de novo.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const ids = [...new Set((Array.isArray(corpo?.ids) ? corpo.ids : []).map(String))] as string[];
  if (!ids.length) return erroJson("Nenhum colaborador informado.");
  if (ids.length > POR_CHAMADA) return erroJson(`Envie no máximo ${POR_CHAMADA} colaboradores por vez.`);
  if (ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) return erroJson("Colaborador inválido.");
  try {
    const db = supabaseAdmin();
    const colabs = await lerColaboradores(db, ids);
    const pendentes = colabs.filter((c) => c.ativo && !geoValida(c));
    const feitos = await emParalelo(pendentes, 4, async (c) => {
      const r = await localizarCasa(c);
      if (!r.ponto) return { id: c.id, ok: false };
      const { error } = await db.from("colaboradores").update({ lat: r.ponto.lat, lng: r.ponto.lng, geo_precisao: r.precisao, geo_em: new Date().toISOString() }).eq("id", c.id);
      if (error) throw new Error(/lat|geo_/.test(error.message) ? `${error.message} — rode supabase/025_colaboradores_geo.sql no SQL Editor do Supabase.` : error.message);
      return { id: c.id, ok: true };
    });
    return Response.json({ localizados: feitos.filter((f) => f.ok).length, ja_tinham: colabs.length - pendentes.length, nao_achados: feitos.filter((f) => !f.ok).map((f) => f.id) });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
