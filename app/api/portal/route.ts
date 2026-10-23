import { supabaseAdmin } from "@/lib/supabase-admin";
import { dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { STATUS, type StatusCorrida } from "@/lib/status";
import { brl, formatarDataHora } from "@/lib/datas";

export const dynamic = "force-dynamic";

/** Portal do fornecedor: todas as corridas dele, pelo link fixo (sem depender da mensagem de cada corrida). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`portal:${token}`, 60, 60))) return muitasTentativas();
  try {
    const db = supabaseAdmin();
    const { data: forn, error } = await db.from("fornecedores").select("id,nome,ativo").eq("token_portal", token).maybeSingle();
    if (error) throw new Error(error.message.includes("token_portal") ? "O banco ainda não tem o portal do fornecedor. Rode supabase/003_melhorias.sql no Supabase." : error.message);
    if (!forn?.ativo) return erroJson("Este link não vale mais. Peça um novo ao planejamento.", 404);
    const desde = new Date(Date.now() - 45 * 86400_000).toISOString();
    const { data: corridas, error: e2 } = await db.from("corridas_lista")
      .select("id,protocolo,status,tipo,data_hora_prevista,origem,destino,solicitante_nome,valor_informado,token_fornecedor,prazo_resposta_em")
      .eq("fornecedor_id", forn.id).gte("data_hora_prevista", desde).order("data_hora_prevista", { ascending: false }).limit(150);
    if (e2) throw new Error(e2.message);
    const item = (c: any) => ({
      protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status as StatusCorrida]?.rotulo ?? c.status,
      quando: formatarDataHora(c.data_hora_prevista), origem: c.origem, destino: c.destino, solicitante: c.solicitante_nome,
      valor: c.valor_informado != null ? brl(Number(c.valor_informado)) : null, link: `/f/${c.token_fornecedor}`, prazo_iso: c.prazo_resposta_em,
    });
    const lista = corridas ?? [];
    return Response.json({
      fornecedor: forn.nome,
      responder: lista.filter((c: any) => ["enviada", "sem_resposta"].includes(c.status)).map(item),
      em_curso: lista.filter((c: any) => ["aceita", "em_andamento"].includes(c.status)).map(item),
      encerradas: lista.filter((c: any) => !["enviada", "sem_resposta", "aceita", "em_andamento", "solicitada"].includes(c.status)).slice(0, 40).map(item),
      total_periodo: brl(lista.filter((c: any) => ["concluida", "validada", "contestada"].includes(c.status)).reduce((s: number, c: any) => s + Number(c.valor_informado ?? 0), 0)),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
