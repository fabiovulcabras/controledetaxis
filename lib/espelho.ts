import type { SupabaseClient } from "@supabase/supabase-js";
import type { Saida } from "./bot/tipos";
import { brl, formatarDataHora } from "./datas";
import { nomeCompetencia } from "./espelho-status";
import { urlApp } from "./whatsapp/link";

type Esp = { qtd?: number; id: string; fornecedor_id: string; competencia: string; total: number; versao: number; prazo_em: string | null; nf_valor?: number | null; nf_numero?: string | null };
type Forn = { nome: string; telefone_whatsapp: string; token_portal: string };

export type AvisoFornecedor = "gerado" | "reemitido" | "lembrete" | "aprovado_tacito" | "pago";

async function dados(db: SupabaseClient, espelhoId: string): Promise<{ esp: Esp; forn: Forn } | null> {
  const { data: esp } = await db.from("espelhos").select("id,fornecedor_id,competencia,total,versao,prazo_em,nf_valor,nf_numero").eq("id", espelhoId).maybeSingle();
  if (!esp) return null;
  const { data: forn } = await db.from("fornecedores").select("nome,telefone_whatsapp,token_portal").eq("id", esp.fornecedor_id).maybeSingle();
  const { count } = await db.from("espelho_itens").select("id", { count: "exact", head: true }).eq("espelho_id", espelhoId);
  return forn ? { esp: { ...(esp as Esp), qtd: count ?? undefined }, forn: forn as Forn } : null;
}

const linkPortal = (forn: Forn, esp: Esp) => `/fornecedor/${forn.token_portal}/espelho/${esp.id}`;

/** Mensagem ao fornecedor sobre o espelho (WhatsApp + notificação no portal). */
export async function avisoFornecedor(db: SupabaseClient, espelhoId: string, tipo: AvisoFornecedor): Promise<Saida[]> {
  const d = await dados(db, espelhoId);
  if (!d) return [];
  const { esp, forn } = d;
  const mes = nomeCompetencia(esp.competencia);
  const prazo = esp.prazo_em ? formatarDataHora(esp.prazo_em).replace(" ", " às ") : "";
  const url = `${urlApp()}${linkPortal(forn, esp)}`;
  const corridas = esp.qtd ? `${esp.qtd} corrida${esp.qtd > 1 ? "s" : ""}` : "";
  const texto = {
    gerado: [
      `Olá, ${forn.nome}! 👋`, "",
      `📄 *Espelho de ${mes} disponível*`,
      ...(corridas ? [`🚕 ${corridas}`] : []),
      `💰 Total: *${brl(esp.total)}*`, "",
      `✅ Confira e aprove ou conteste os itens até *${prazo}*:`,
      url, "",
      `⚠️ Sem resposta até lá, o espelho é aprovado automaticamente.`,
      `Depois de aprovado, envie a NF pelo portal.`,
    ].join("\n"),
    reemitido: [
      `Olá, ${forn.nome}! 👋`, "",
      `🔄 *Espelho de ${mes} reenviado* (versão ${esp.versao})`,
      `Analisamos sua contestação.`,
      `💰 Novo total: *${brl(esp.total)}*`, "",
      `✅ Confira e aprove até *${prazo}*:`,
      url,
    ].join("\n"),
    lembrete: [
      `⏰ *Lembrete: espelho de ${mes}*`,
      `💰 Total: *${brl(esp.total)}*`, "",
      `Aguardamos sua conferência até *${prazo}*:`,
      url, "",
      `⚠️ Sem resposta, ele é aprovado automaticamente.`,
    ].join("\n"),
    aprovado_tacito: [
      `✅ *Espelho de ${mes} aprovado automaticamente*`,
      `O prazo de conferência terminou.`,
      `💰 Total: *${brl(esp.total)}*`, "",
      `📎 Envie a NF desse valor pelo portal:`,
      url,
    ].join("\n"),
    pago: [
      `💸 *Pagamento do espelho de ${mes} registrado*`,
      ...(esp.nf_numero ? [`NF ${esp.nf_numero}`] : []),
      `💰 Valor: *${brl(esp.nf_valor ?? esp.total)}*`, "",
      `Obrigado! 🙏`,
    ].join("\n"),
  }[tipo];
  return [{ para: forn.telefone_whatsapp, texto, link: linkPortal(forn, esp) }];
}

/** Aviso ao planejamento (WhatsApp dos números em Parâmetros, e-mail e notificação no painel). */
export async function avisoPlanejamento(db: SupabaseClient, espelhoId: string, texto: string): Promise<Saida[]> {
  const d = await dados(db, espelhoId);
  if (!d) return [];
  const { data: par } = await db.from("parametros").select("valor").eq("chave", "planejamento_telefones").maybeSingle();
  const fones = String(par?.valor ?? "").split(/[,;\s]+/).map((t) => t.replace(/\D/g, "")).filter((t) => t.length >= 10);
  const titulo = `Espelho ${nomeCompetencia(d.esp.competencia)} · ${d.forn.nome}`;
  const link = `/conciliacao?espelho=${espelhoId}#espelhos`;
  return fones.map((para) => ({
    para, texto: `${titulo}: ${texto}${urlApp() ? `\n${urlApp()}${link}` : ""}`, link,
    template: { nome: "alerta_corrida_planejamento", parametros: [titulo, texto, "-", d.forn.nome], sempre: true },
  }));
}

/**
 * Agendador: lembrete no 3º dia útil e aprovação tácita no fim do 5º para os espelhos aguardando o fornecedor.
 * Se a migração 015 ainda não rodou, não faz nada.
 */
export async function processarEspelhos(db: SupabaseClient, agora = new Date()): Promise<Saida[]> {
  const { data, error } = await db.from("espelhos").select("id,lembrete_em,lembrete_enviado_em,prazo_em").eq("status", "aguardando");
  if (error) return [];
  const saidas: Saida[] = [];
  for (const e of data ?? []) {
    if (e.prazo_em && new Date(e.prazo_em) <= agora) {
      const { error: eAp } = await db.rpc("fn_aprovar_espelho", { p_espelho: e.id, p_origem: "tacita" });
      if (eAp) { console.error("Aprovação tácita falhou", e.id, eAp.message); continue; }
      saidas.push(...await avisoFornecedor(db, e.id, "aprovado_tacito"), ...await avisoPlanejamento(db, e.id, "aprovado automaticamente (fornecedor não respondeu no prazo)."));
    } else if (e.lembrete_em && !e.lembrete_enviado_em && new Date(e.lembrete_em) <= agora) {
      await db.from("espelhos").update({ lembrete_enviado_em: agora.toISOString() }).eq("id", e.id);
      saidas.push(...await avisoFornecedor(db, e.id, "lembrete"));
    }
  }
  return saidas;
}
