import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { percursoDeCasas, type Sentido } from "@/lib/extras-rota";
import { emParalelo, lerColaboradores, pontoDaUnidade, pontoGuardado } from "@/lib/extras-servidor";
import { rotaComCache } from "@/lib/km-corrida";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CARROS_POR_CHAMADA = 8;

/** Km real (menor trajeto por ruas, com cache de 30 dias) de até 8 carros do plano, cada um na ordem em que o carro passa. */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const sentido: Sentido = corpo?.sentido === "entrada" ? "entrada" : "saida";
  const carros: string[][] = Array.isArray(corpo?.carros) ? corpo.carros.map((c: unknown) => (Array.isArray(c) ? c.map(String) : [])) : [];
  if (!carros.length || carros.length > CARROS_POR_CHAMADA) return erroJson(`Envie de 1 a ${CARROS_POR_CHAMADA} carros por vez.`);
  const todos = [...new Set(carros.flat())];
  if (todos.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) return erroJson("Colaborador inválido.");
  try {
    const db = supabaseAdmin();
    const { data: unidade } = await db.from("unidades").select("nome,endereco_padrao,lat,lng").eq("id", String(corpo?.unidade_id ?? "")).eq("ativo", true).maybeSingle();
    if (!unidade) return erroJson("Escolha a unidade da empresa.");
    const { ponto: pontoUnidade } = await pontoDaUnidade(unidade);
    const porId = new Map((await lerColaboradores(db, todos)).map((c) => [c.id, c]));
    if (!pontoUnidade) return Response.json({ km: carros.map(() => null) });
    const km = await emParalelo(carros, 4, async (ids) => {
      const casas = ids.map((i) => { const c = porId.get(i); return c ? pontoGuardado(c) : null; });
      if (casas.some((p) => !p)) return null;
      const seq = percursoDeCasas(casas as { lat: number; lng: number }[], pontoUnidade, sentido);
      try {
        const pernas = await Promise.all(seq.slice(1).map((p, i) => rotaComCache(db, seq[i], p)));
        return { km: Math.round(pernas.reduce((s, r) => s + r.km, 0) * 100) / 100, estimado: pernas.some((r) => r.fonte === "estimada") };
      } catch { return null; }
    });
    return Response.json({ km });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
