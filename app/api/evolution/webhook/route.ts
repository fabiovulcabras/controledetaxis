import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { processarEntrada } from "@/lib/bot/motor";
import { lerWebhookEvolution } from "@/lib/whatsapp/evolution";
import { completarLocalizacao, despacharSaidas, registrarEntrada, traduzirOpcaoNumerada, vincularEntrada } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Webhook da Evolution API (evento MESSAGES_UPSERT).
 * Configure na instância: URL = https://<seu-app>/api/evolution/webhook?token=<EVOLUTION_WEBHOOK_TOKEN>,
 * "Webhook by events" desligado, evento MESSAGES_UPSERT ligado.
 *
 * Quem escreve é identificado pelo telefone, no motor do bot:
 *  - pessoa autorizada → conversa para pedir a corrida; ao confirmar, a corrida é gravada e enviada ao 1º fornecedor da fila;
 *  - fornecedor → "1" aceita, "2" recusa (a recusa passa a corrida ao próximo da fila); depois, motorista e valor.
 */
export async function POST(req: Request) {
  const segredo = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (!segredo || new URL(req.url).searchParams.get("token") !== segredo) return new Response("Não autorizado", { status: 401 });

  let corpo: any;
  try { corpo = await req.json(); } catch { return new Response("JSON inválido", { status: 400 }); }

  const db = supabaseAdmin();
  const repo = new RepoSupabase(db);
  for (const { entrada: bruta, waId } of lerWebhookEvolution(corpo)) {
    try {
      // "1", "2"… viram a opção correspondente da última mensagem enviada a este número
      const entrada = await traduzirOpcaoNumerada(db, bruta);
      const id = await registrarEntrada(db, entrada, "evolution", waId || undefined);
      if (!id) continue; // a Evolution reenviou a mesma mensagem: já foi tratada
      const saidas = await processarEntrada(await completarLocalizacao(entrada), repo, new Date());
      await vincularEntrada(db, id, saidas);
      await despacharSaidas(db, saidas); // envia pela Evolution e agenda no QStash o prazo de quem recebeu a corrida
    } catch (err) {
      console.error("Erro ao processar mensagem da Evolution", err instanceof Error ? err.message : err);
    }
  }
  // Sempre 200: com erro, a Evolution reenvia e o bot responderia em dobro
  return Response.json({ ok: true });
}
