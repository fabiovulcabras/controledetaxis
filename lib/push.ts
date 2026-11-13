import type { SupabaseClient } from "@supabase/supabase-js";
import type { Saida } from "./bot/tipos";
import { normalizarTelefone, variantesTelefone } from "./telefone";
import { chavesVapid, enviarPush } from "./webpush";

/**
 * Notificação push junto de cada mensagem do sistema: toda mensagem gerada para um número (Saida) também
 * vira notificação nos aparelhos inscritos daquela pessoa — solicitante, fornecedor ou planejamento.
 * Vale em qualquer modo de envio (Evolution, Meta ou só links).
 */

export type Papel = "solicitante" | "fornecedor" | "planejamento";
export type Notificacao = { titulo: string; corpo: string; url: string; tag: string };

/** Texto da mensagem enxuto para a notificação: sem negrito do WhatsApp, linhas juntas, até ~240 caracteres. */
export function corpoNotificacao(texto: string): string {
  const t = String(texto ?? "").replace(/\*/g, "").replace(/\n{2,}/g, "\n").trim();
  return t.length > 240 ? `${t.slice(0, 237).trimEnd()}…` : t;
}

export function montarNotificacao(papel: Papel, texto: string, ctx: { protocolo?: string | null; url: string; corridaId?: string | null }): Notificacao {
  const titulo = papel === "planejamento"
    ? `Planejamento${ctx.protocolo ? ` · ${ctx.protocolo}` : ""}`
    : ctx.protocolo ? `Corrida ${ctx.protocolo}` : papel === "solicitante" ? "Seu táxi" : "Corrida de táxi";
  return { titulo, corpo: corpoNotificacao(texto), url: ctx.url, tag: `${papel}:${ctx.corridaId ?? "geral"}` };
}

type Inscricao = { id: string; endpoint: string; p256dh: string; auth: string; tipo: Papel; solicitante_id: string | null; fornecedor_id: string | null; falhas: number };

/** Envia as notificações das mensagens geradas. Sem chaves VAPID ou sem a migração 011, não faz nada. */
export async function notificarPush(db: SupabaseClient, saidas: Saida[]): Promise<void> {
  const chaves = chavesVapid();
  if (!chaves || !saidas.length) return;

  const fones = [...new Set(saidas.map((s) => normalizarTelefone(s.para)))];
  const variantes = [...new Set(fones.flatMap(variantesTelefone))];
  const idsCorrida = [...new Set(saidas.map((s) => s.corridaId).filter(Boolean))] as string[];
  const [sol, forn, par, cor] = await Promise.all([
    db.from("solicitantes").select("id,telefone_whatsapp,token_pedido").in("telefone_whatsapp", variantes),
    db.from("fornecedores").select("id,telefone_whatsapp,token_portal").in("telefone_whatsapp", variantes),
    db.from("parametros").select("valor").eq("chave", "planejamento_telefones").maybeSingle(),
    idsCorrida.length ? db.from("corridas").select("id,protocolo,fornecedor_id,token_fornecedor").in("id", idsCorrida) : Promise.resolve({ data: [] as any[] }),
  ]);
  const chave = (t: string) => normalizarTelefone(t);
  const solPorFone = new Map((sol.data ?? []).map((s: any) => [chave(s.telefone_whatsapp), s]));
  const fornPorFone = new Map((forn.data ?? []).map((f: any) => [chave(f.telefone_whatsapp), f]));
  const planejamento = new Set(String(par.data?.valor ?? "").split(/[,;\s]+/).filter(Boolean).map(chave));
  const corridas = new Map(((cor as any).data ?? []).map((c: any) => [c.id, c]));

  const solIds = [...new Set([...solPorFone.values()].map((s: any) => s.id))];
  const fornIds = [...new Set([...fornPorFone.values()].map((f: any) => f.id))];
  const temPlanejamento = fones.some((f) => planejamento.has(f));
  const filtros = [
    solIds.length ? `solicitante_id.in.(${solIds.join(",")})` : null,
    fornIds.length ? `fornecedor_id.in.(${fornIds.join(",")})` : null,
    temPlanejamento ? "tipo.eq.planejamento" : null,
  ].filter(Boolean);
  if (!filtros.length) return;
  const { data: inscricoes, error } = await db.from("push_inscricoes").select("*").or(filtros.join(","));
  if (error) { console.error("Push: não foi possível ler as inscrições (rodou a migração 011?)", error.message); return; }
  const lista = (inscricoes ?? []) as Inscricao[];
  if (!lista.length) return;

  const envios: { insc: Inscricao; dados: Notificacao }[] = [];
  for (const s of saidas) {
    const fone = chave(s.para);
    const c: any = s.corridaId ? corridas.get(s.corridaId) : null;
    const vistos = new Set<string>();
    const adicionar = (papel: Papel, alvo: Inscricao[], url: string) => {
      for (const insc of alvo) {
        if (vistos.has(insc.endpoint)) continue;
        vistos.add(insc.endpoint);
        envios.push({ insc, dados: montarNotificacao(papel, s.texto, { protocolo: c?.protocolo, url, corridaId: s.corridaId }) });
      }
    };
    const so = solPorFone.get(fone) as any;
    if (so) adicionar("solicitante", lista.filter((i) => i.solicitante_id === so.id), `/pedir/${so.token_pedido}`);
    const fo = fornPorFone.get(fone) as any;
    if (fo) adicionar("fornecedor", lista.filter((i) => i.fornecedor_id === fo.id),
      s.link?.startsWith("/fornecedor/") ? s.link : c && c.fornecedor_id === fo.id && c.token_fornecedor ? `/f/${c.token_fornecedor}` : `/fornecedor/${fo.token_portal}`);
    if (planejamento.has(fone)) adicionar("planejamento", lista.filter((i) => i.tipo === "planejamento"), s.link && !s.link.startsWith("/fornecedor/") ? s.link : s.corridaId ? `/corridas?id=${s.corridaId}` : "/");
  }

  const resultados = await Promise.allSettled(envios.map(async ({ insc, dados }) => ({ insc, r: await enviarPush(insc, dados, chaves) })));
  for (const res of resultados) {
    if (res.status !== "fulfilled") continue;
    const { insc, r } = res.value;
    if (r.expirada || (!r.ok && insc.falhas >= 9)) await db.from("push_inscricoes").delete().eq("id", insc.id);
    else if (r.ok) await db.from("push_inscricoes").update({ ultimo_envio_em: new Date().toISOString(), falhas: 0 }).eq("id", insc.id);
    else { console.error("Push falhou", r.status, r.erro); await db.from("push_inscricoes").update({ falhas: insc.falhas + 1 }).eq("id", insc.id); }
  }
}
