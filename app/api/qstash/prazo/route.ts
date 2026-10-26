import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { tratarPrazoVencido } from "@/lib/bot/acoes";
import { assinaturaQStashValida } from "@/lib/qstash";
import { despacharSaidas, enviarSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Chamado pelo Upstash QStash no fim do prazo de resposta de uma tentativa (agendado ao enviar a corrida ao fornecedor).
 *
 * 1. Confere a assinatura: só o QStash chama esta rota.
 * 2. Se a tentativa não está mais pendente (fornecedor respondeu "1"/"2", corrida cancelada ou passada adiante), não faz nada.
 * 3. Se ainda está pendente e o prazo venceu: o fornecedor perde a vez, a corrida vai ao próximo da fila
 *    (nova mensagem + novo agendamento no QStash). Sem próximo, o planejamento é alertado.
 *
 * Responde 200 nos casos tratados ou ignorados; 500 só em falha inesperada, para o QStash tentar de novo.
 */
export async function POST(req: Request) {
  const corpo = await req.text();
  const valida = await assinaturaQStashValida(req.headers.get("upstash-signature"), corpo,
    [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY]);
  if (!valida) return new Response("Assinatura inválida", { status: 401 });

  let tentativaId = "";
  try { tentativaId = String(JSON.parse(corpo)?.tentativa_id ?? ""); } catch { /* corpo inválido */ }
  if (!/^[0-9a-f-]{36}$/.test(tentativaId)) return Response.json({ ok: true, ignorado: "corpo sem tentativa_id" });

  const db = supabaseAdmin();
  const repo = new RepoSupabase(db);
  const agora = new Date();
  try {
    const { data: t, error } = await db.from("corrida_tentativas").select("*").eq("id", tentativaId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!t || t.status !== "pendente") return Response.json({ ok: true, ignorado: `tentativa ${t?.status ?? "inexistente"}` });

    const c = await repo.corrida(t.corrida_id);
    // Confere com a corrida: ainda aguardando este mesmo fornecedor, com o prazo vencido (o prazo pode ter sido estendido)
    if (!c || c.status !== "enviada" || c.fornecedor_id !== t.fornecedor_id) return Response.json({ ok: true, ignorado: "corrida já mudou" });
    if (c.prazo_resposta_em && new Date(c.prazo_resposta_em).getTime() > agora.getTime() + 5_000) return Response.json({ ok: true, ignorado: "prazo ainda não venceu" });

    // A troca de status trava a corrida no banco: se o "1" do fornecedor chegar ao mesmo tempo, só um dos dois vence
    let saidas;
    try {
      saidas = await tratarPrazoVencido(repo, c, agora, { reenviar: envioAutomatico() });
    } catch (err) {
      return Response.json({ ok: true, ignorado: `corrida mudou durante o processamento (${err instanceof Error ? err.message : err})` });
    }
    if (!envioAutomatico()) await enviarSaidas(db, saidas, "simulado"); // sem envio automático, fica no histórico da corrida
    await despacharSaidas(db, saidas); // envia ao próximo fornecedor, e-mails de alerta e agenda o novo prazo
    return Response.json({ ok: true, corrida: c.protocolo, mensagens: saidas.length });
  } catch (err) {
    console.error("Erro no prazo do QStash", err);
    return Response.json({ ok: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
