import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { enviarLembretes, verificarPrazos } from "@/lib/bot/acoes";
import { despacharSaidas, enviarSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

/**
 * Rodar a cada 1–5 minutos (Supabase pg_cron, Vercel Cron no plano Pro ou outro agendador).
 * Envie o cabeçalho Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return new Response("Não autorizado", { status: 401 });
  const db = supabaseAdmin();
  const repo = new RepoSupabase(db);
  const agora = new Date();
  try {
    // Reenvio automático no prazo vencido só com envio automático (Meta ou Evolution): no modo por links ninguém levaria a mensagem ao próximo fornecedor.
    // Com o QStash ligado, os prazos já são tratados na hora; este agendador fica como rede de segurança.
    const oficial = envioAutomatico();
    const prazos = await verificarPrazos(repo, agora, { reenviar: oficial });
    const lembretes = await enviarLembretes(repo, agora);
    if (oficial) await despacharSaidas(db, [...prazos, ...lembretes]);
    else {
      await enviarSaidas(db, [...prazos, ...lembretes], "simulado"); // fica no histórico de mensagens da corrida
      await despacharSaidas(db, prazos); // e-mails de alerta, se configurados
    }
    return Response.json({ ok: true, mensagens: prazos.length + lembretes.length });
  } catch (err) {
    console.error("Erro no agendador", err);
    return Response.json({ ok: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
