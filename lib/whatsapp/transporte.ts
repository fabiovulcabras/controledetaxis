import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entrada, Saida } from "../bot/tipos";
import { payloadMeta } from "./meta";
import { textoTemplate } from "./templates";
import { enviarEmailsPlanejamento } from "../email";

export type Canal = "whatsapp" | "simulado";

/** Modo de envio: "meta" exige WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID; sem eles, as mensagens só ficam gravadas no histórico. */
export const modoEnvio = (): Canal =>
  process.env.WHATSAPP_MODO === "meta" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID ? "whatsapp" : "simulado";

/** Grava a mensagem recebida e devolve o id. Devolve null se ela já tinha sido recebida (a Meta reenvia em caso de demora). */
export async function registrarEntrada(db: SupabaseClient, e: Entrada, canal: Canal, waId?: string, bruto?: unknown): Promise<string | null> {
  const { data, error } = await db.from("mensagens").insert({
    direcao: "entrada", canal, telefone: e.telefone, wa_message_id: waId || null,
    conteudo: { texto: e.texto ?? null, botaoId: e.botaoId ?? null, localizacao: e.localizacao ?? null, ...(bruto ? { bruto } : {}) },
  }).select("id").single();
  if (error?.code === "23505") return null;
  if (error) throw new Error(`Registrar mensagem recebida: ${error.message}`);
  return data.id as string;
}

/** Liga a mensagem recebida à corrida tratada nela, para o histórico da corrida mostrar os dois lados da conversa. */
export async function vincularEntrada(db: SupabaseClient, mensagemId: string | null, saidas: Saida[]): Promise<void> {
  const corridaId = saidas.find((s) => s.corridaId)?.corridaId;
  if (mensagemId && corridaId) await db.from("mensagens").update({ corrida_id: corridaId }).eq("id", mensagemId);
}

/**
 * Destino final das mensagens geradas pelo app: com a API oficial, saem pelo WhatsApp;
 * em qualquer modo, os alertas do planejamento também vão por e-mail quando configurado.
 */
export async function despacharSaidas(db: SupabaseClient, saidas: Saida[]): Promise<void> {
  if (!saidas.length) return;
  if (modoEnvio() === "whatsapp") await enviarSaidas(db, saidas, "whatsapp");
  await enviarEmailsPlanejamento(db, saidas);
}

/** A Meta só aceita texto livre até 24 h depois da última mensagem da pessoa. */
async function janelaAberta(db: SupabaseClient, telefone: string, canal: Canal, cache: Map<string, boolean>): Promise<boolean> {
  if (cache.has(telefone)) return cache.get(telefone)!;
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from("mensagens").select("id", { count: "exact", head: true })
    .eq("telefone", telefone).eq("direcao", "entrada").eq("canal", canal).gte("criado_em", desde);
  const aberta = (count ?? 0) > 0;
  cache.set(telefone, aberta);
  return aberta;
}

/** Envia (ou simula) as mensagens do bot e registra cada uma no histórico. */
export async function enviarSaidas(db: SupabaseClient, saidas: Saida[], canal: Canal = modoEnvio()): Promise<void> {
  const cache = new Map<string, boolean>();
  for (const s of saidas) {
    const usarTemplate = !!s.template && (s.template.sempre || !(await janelaAberta(db, s.para, canal, cache)));
    const texto = usarTemplate && s.template ? textoTemplate(s.template.nome, s.template.parametros) : s.texto;
    const registro: Record<string, unknown> = {
      direcao: "saida", canal, telefone: s.para, corrida_id: s.corridaId ?? null,
      template: usarTemplate ? s.template!.nome : null,
      conteudo: {
        texto,
        // Modelos de fornecedor têm botões de resposta rápida; os demais modelos não têm opções
        opcoes: usarTemplate ? (s.template!.botoes?.length ? s.opcoes ?? null : null) : s.opcoes ?? null,
        rotuloLista: usarTemplate ? null : s.rotuloLista ?? null,
        parametros: usarTemplate ? s.template!.parametros : null,
      },
    };

    if (canal === "simulado") {
      registro.status_envio = "simulado";
    } else {
      try {
        const versao = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
        const resp = await fetch(`https://graph.facebook.com/${versao}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(payloadMeta(s, usarTemplate)),
        });
        const corpo: any = await resp.json().catch(() => ({}));
        if (resp.ok) {
          registro.wa_message_id = corpo?.messages?.[0]?.id ?? null;
          registro.status_envio = "enviada";
        } else {
          registro.status_envio = "falhou";
          registro.erro = corpo?.error?.message ?? `HTTP ${resp.status}`;
          console.error("Falha ao enviar WhatsApp", { para: s.para, erro: registro.erro });
        }
      } catch (err) {
        registro.status_envio = "falhou";
        registro.erro = err instanceof Error ? err.message : String(err);
      }
    }
    const { error } = await db.from("mensagens").insert(registro);
    if (error) console.error("Falha ao registrar mensagem enviada", error.message);
  }
}
