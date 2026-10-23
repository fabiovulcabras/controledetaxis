import { supabaseAdmin } from "@/lib/supabase-admin";
import { RepoSupabase } from "@/lib/bot/repo-supabase";
import { processarEntrada } from "@/lib/bot/motor";
import { enviarSaidas, registrarEntrada } from "@/lib/whatsapp/transporte";
import { normalizarTelefone } from "@/lib/telefone";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import type { Entrada } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";

/** Simula uma mensagem chegando ao número da empresa. As respostas ficam gravadas como canal "simulado". */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const telefone = normalizarTelefone(String(corpo?.telefone ?? ""));
  if (telefone.length < 12) return erroJson("Informe um telefone com DDD.");
  const entrada: Entrada = { telefone, texto: corpo?.texto ?? undefined, botaoId: corpo?.botaoId ?? undefined, localizacao: corpo?.localizacao ?? undefined };
  if (!entrada.texto && !entrada.botaoId && !entrada.localizacao) return erroJson("Mensagem vazia.");

  try {
    const db = supabaseAdmin();
    await registrarEntrada(db, entrada, "simulado");
    const saidas = await processarEntrada(entrada, new RepoSupabase(db), new Date());
    await enviarSaidas(db, saidas, "simulado");
    return Response.json({ ok: true, respostas: saidas.length });
  } catch (err) {
    console.error("Erro no simulador", err);
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Apaga as mensagens simuladas e as conversas em andamento dos telefones informados. */
export async function DELETE(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => ({}));
  const telefones: string[] = (corpo?.telefones ?? []).map((t: string) => normalizarTelefone(t)).filter(Boolean);
  try {
    const db = supabaseAdmin();
    await db.from("mensagens").delete().eq("canal", "simulado");
    if (telefones.length) await db.from("conversas_bot").delete().in("telefone", telefones);
    return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
