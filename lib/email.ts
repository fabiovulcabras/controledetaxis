import type { SupabaseClient } from "@supabase/supabase-js";
import type { Saida } from "./bot/tipos";

const PARA_EMAIL = new Set(["alerta_corrida_planejamento", "nova_corrida_planejamento"]);

/**
 * Envia por e-mail os avisos do planejamento (alertas e, se ligado, corridas novas).
 * Só funciona com RESEND_API_KEY no servidor e e-mails no parâmetro planejamento_emails; sem isso, não faz nada.
 * O plano gratuito do Resend basta para o volume de alertas.
 */
export async function enviarEmailsPlanejamento(db: SupabaseClient, saidas: Saida[]): Promise<number> {
  const chave = process.env.RESEND_API_KEY;
  const avisos = [...new Map(saidas.filter((s) => s.template && PARA_EMAIL.has(s.template.nome)).map((s) => [s.texto, s])).values()];
  if (!chave || !avisos.length) return 0;
  const { data } = await db.from("parametros").select("valor").eq("chave", "planejamento_emails").maybeSingle();
  const para = String(data?.valor ?? "").split(/[,;\s]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!para.length) return 0;
  let enviados = 0;
  for (const s of avisos) {
    const assunto = s.template!.nome === "alerta_corrida_planejamento" ? `Atenção: corrida ${s.template!.parametros[0]}` : `Nova corrida ${s.template!.parametros[0]}`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_REMETENTE || "Controle de Táxis <onboarding@resend.dev>", to: para, subject: assunto, text: s.texto }),
      });
      if (r.ok) enviados++; else console.error("Falha ao enviar e-mail", r.status, await r.text().catch(() => ""));
    } catch (err) {
      console.error("Falha ao enviar e-mail", err);
    }
  }
  return enviados;
}
