import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { processarEntrada } from "@/lib/bot/motor";
import { assinaturaValida, lerStatusEntrega, lerWebhook } from "@/lib/whatsapp/meta";
import { completarLocalizacao, despacharSaidas, registrarEntrada, vincularEntrada } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta (feita uma vez ao configurar o app). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ok = url.searchParams.get("hub.mode") === "subscribe"
    && !!process.env.WHATSAPP_VERIFY_TOKEN
    && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Token de verificação inválido", { status: 403 });
}

/** Mensagens e avisos de entrega enviados pela Meta. */
export async function POST(req: Request) {
  const bruto = await req.text();
  if (!assinaturaValida(bruto, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return new Response("Assinatura inválida", { status: 401 });
  }
  let corpo: any;
  try { corpo = JSON.parse(bruto); } catch { return new Response("JSON inválido", { status: 400 }); }

  const db = supabaseAdmin();
  for (const st of lerStatusEntrega(corpo)) {
    await db.from("mensagens").update({ status_envio: st.status, ...(st.erro ? { erro: st.erro } : {}) }).eq("wa_message_id", st.waId).eq("direcao", "saida");
  }

  const repo = new RepoSupabase(db);
  for (const { entrada, waId, bruto: msg } of lerWebhook(corpo)) {
    try {
      const id = await registrarEntrada(db, entrada, "whatsapp", waId, msg);
      if (!id) continue; // já processada
      const saidas = await processarEntrada(await completarLocalizacao(entrada), repo, new Date());
      await vincularEntrada(db, id, saidas);
      await despacharSaidas(db, saidas);
    } catch (err) {
      console.error("Erro ao processar mensagem do WhatsApp", err instanceof Error ? err.message : err);
    }
  }
  // Sempre 200: a Meta reenvia mensagens que recebem erro, o que duplicaria respostas
  return Response.json({ ok: true });
}
