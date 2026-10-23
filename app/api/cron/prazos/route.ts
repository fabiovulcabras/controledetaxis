import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { enviarLembretes, verificarPrazos } from "@/lib/bot/acoes";
import { enviarSaidas, modoEnvio } from "@/lib/whatsapp/transporte";

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
    const prazos = await verificarPrazos(repo, agora);
    const lembretes = await enviarLembretes(repo, agora);
    await enviarSaidas(db, [...prazos, ...lembretes], modoEnvio());
    return Response.json({ ok: true, mensagens: prazos.length + lembretes.length });
  } catch (err) {
    console.error("Erro no agendador", err);
    return Response.json({ ok: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
