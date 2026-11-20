import { segredoConfere } from "@/lib/segredo";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { enviarLembretes, verificarPrazos } from "@/lib/bot/acoes";
import { despacharSaidas, enviarSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { processarEspelhos } from "@/lib/espelho";
import { gerarRecorrentes } from "@/lib/recorrentes";

export const dynamic = "force-dynamic";

/**
 * Rodar a cada 1–5 minutos (Supabase pg_cron, Vercel Cron no plano Pro ou outro agendador).
 * Envie o cabeçalho Authorization: Bearer <CRON_SECRET>.
 */
/**
 * LGPD: uma vez por dia apaga mensagens e conversas antigas e tira coordenadas das corridas antigas
 * (parâmetro retencao_meses). Sem a migração 020, não faz nada.
 */
async function aplicarRetencaoDiaria(db: ReturnType<typeof supabaseAdmin>, agora: Date): Promise<unknown> {
  const hoje = agora.toISOString().slice(0, 10);
  const { data: ultima } = await db.from("parametros").select("valor").eq("chave", "retencao_ultima_execucao").maybeSingle();
  if (ultima?.valor === hoje) return null;
  const { data, error } = await db.rpc("fn_aplicar_retencao");
  if (error) return null;
  // Cache de trajetos (30 dias) também é limpo
  await db.from("rotas_cache").delete().lt("criado_em", new Date(agora.getTime() - 30 * 86400_000).toISOString()).then(() => null, () => null);
  await db.from("parametros").upsert({ chave: "retencao_ultima_execucao", valor: hoje, descricao: "Data da última limpeza de dados antigos (automática)" });
  return data;
}

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredoConfere(req.headers.get("authorization"), segredo ? `Bearer ${segredo}` : null)) return new Response("Não autorizado", { status: 401 });
  const db = supabaseAdmin();
  const repo = new RepoSupabase(db);
  const agora = new Date();
  try {
    // Reenvio automático no prazo vencido só com envio automático (Meta ou Evolution): no modo por links ninguém levaria a mensagem ao próximo fornecedor.
    // Com o QStash ligado, os prazos já são tratados na hora; este agendador fica como rede de segurança.
    const oficial = envioAutomatico();
    const prazos = await verificarPrazos(repo, agora, { reenviar: oficial });
    const lembretes = await enviarLembretes(repo, agora);
    // Espelhos do mês: lembrete no 3º dia útil e aprovação tácita no fim do 5º
    lembretes.push(...await processarEspelhos(db, agora));
    // Corridas recorrentes (Cadastros › Recorrentes) que entram na antecedência
    lembretes.push(...await gerarRecorrentes(db, repo, agora).catch((err) => { console.error("Recorrentes", err); return []; }));
    if (oficial) await despacharSaidas(db, [...prazos, ...lembretes]);
    else {
      await enviarSaidas(db, [...prazos, ...lembretes], "simulado"); // fica no histórico de mensagens da corrida
      await despacharSaidas(db, [...prazos, ...lembretes]); // e-mails de alerta e notificações push
    }
    const retencao = await aplicarRetencaoDiaria(db, agora);
    return Response.json({ ok: true, mensagens: prazos.length + lembretes.length, ...(retencao ? { retencao } : {}) });
  } catch (err) {
    console.error("Erro no agendador", err);
    return Response.json({ ok: false, erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
