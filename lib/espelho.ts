import type { SupabaseClient } from "@supabase/supabase-js";
import type { Saida } from "./bot/tipos";
import { brl, formatarDataHora } from "./datas";
import { nomeCompetencia } from "./espelho-status";

const URL_APP = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
type Esp = { id: string; fornecedor_id: string; competencia: string; total: number; versao: number; prazo_em: string | null; nf_valor?: number | null; nf_numero?: string | null };
type Forn = { nome: string; telefone_whatsapp: string; token_portal: string };

export type AvisoFornecedor = "gerado" | "reemitido" | "lembrete" | "aprovado_tacito" | "pago";

async function dados(db: SupabaseClient, espelhoId: string): Promise<{ esp: Esp; forn: Forn } | null> {
  const { data: esp } = await db.from("espelhos").select("id,fornecedor_id,competencia,total,versao,prazo_em,nf_valor,nf_numero").eq("id", espelhoId).maybeSingle();
  if (!esp) return null;
  const { data: forn } = await db.from("fornecedores").select("nome,telefone_whatsapp,token_portal").eq("id", esp.fornecedor_id).maybeSingle();
  return forn ? { esp: esp as Esp, forn: forn as Forn } : null;
}

const linkPortal = (forn: Forn, esp: Esp) => `/fornecedor/${forn.token_portal}/espelho/${esp.id}`;

/** Mensagem ao fornecedor sobre o espelho (WhatsApp + notificação no portal). */
export async function avisoFornecedor(db: SupabaseClient, espelhoId: string, tipo: AvisoFornecedor): Promise<Saida[]> {
  const d = await dados(db, espelhoId);
  if (!d) return [];
  const { esp, forn } = d;
  const mes = nomeCompetencia(esp.competencia);
  const prazo = esp.prazo_em ? formatarDataHora(esp.prazo_em) : "";
  const url = `${URL_APP}${linkPortal(forn, esp)}`;
  const texto = {
    gerado: `Olá, ${forn.nome}! O espelho de ${mes} está pronto: ${brl(esp.total)}.\nConfira as corridas e aprove ou conteste até ${prazo}: ${url}\nSem resposta até lá, o espelho é aprovado automaticamente. Depois de aprovado, envie a NF pelo portal.`,
    reemitido: `Olá, ${forn.nome}! Analisamos sua contestação e o espelho de ${mes} foi reenviado (versão ${esp.versao}): ${brl(esp.total)}.\nConfira e aprove até ${prazo}: ${url}`,
    lembrete: `Lembrete: o espelho de ${mes} (${brl(esp.total)}) aguarda sua conferência até ${prazo}. Sem resposta, ele é aprovado automaticamente.\n${url}`,
    aprovado_tacito: `O prazo de conferência do espelho de ${mes} terminou e ele foi aprovado automaticamente: ${brl(esp.total)}.\nEnvie a NF desse valor pelo portal: ${url}`,
    pago: `Pagamento do espelho de ${mes} registrado${esp.nf_numero ? ` (NF ${esp.nf_numero})` : ""}: ${brl(esp.nf_valor ?? esp.total)}. Obrigado!`,
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
    para, texto: `${titulo}: ${texto}${URL_APP ? `\n${URL_APP}${link}` : ""}`, link,
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
