import type { Entrada, Opcao, Saida } from "../bot/tipos";

/**
 * Evolution API (WhatsApp não oficial, via WhatsApp Web). Aqui ficam só funções puras e o envio por fetch:
 * ler o webhook, montar o texto com as opções numeradas e traduzir a resposta "1" para a opção escolhida.
 *
 * Variáveis: EVOLUTION_URL (ex.: https://evolution.seudominio.com), EVOLUTION_API_KEY (apikey da instância ou global),
 * EVOLUTION_INSTANCIA (nome da instância conectada ao número), EVOLUTION_WEBHOOK_TOKEN (segredo da URL do webhook).
 */

export type MensagemEvolution = { entrada: Entrada; waId: string; nome: string | null };

/** Só o número, sem @s.whatsapp.net. Com o endereçamento novo do WhatsApp (@lid), o número vem em outro campo. */
export function telefoneDaChave(key: any, data: any): string | null {
  const jid: string = key?.remoteJid ?? "";
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) return null; // grupos, status e canais
  const real = jid.endsWith("@lid") ? key?.senderPn ?? key?.remoteJidAlt ?? data?.senderPn ?? "" : jid;
  const numero = String(real).split("@")[0].split(":")[0].replace(/\D/g, "");
  return numero.length >= 10 ? numero : null;
}

/** Converte o evento messages.upsert da Evolution (v2) nas entradas do motor do bot. Ignora o que o próprio número enviou. */
export function lerWebhookEvolution(corpo: any): MensagemEvolution[] {
  const evento = String(corpo?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (evento !== "messages.upsert") return [];
  const lista = Array.isArray(corpo?.data) ? corpo.data : corpo?.data?.messages ?? [corpo?.data];
  const saida: MensagemEvolution[] = [];
  for (const d of lista) {
    if (!d?.key || d.key.fromMe) continue;
    const telefone = telefoneDaChave(d.key, d);
    if (!telefone) continue;
    const m = d.message ?? {};
    const loc = m.locationMessage ?? m.liveLocationMessage;
    const botaoId = m.buttonsResponseMessage?.selectedButtonId ?? m.listResponseMessage?.singleSelectReply?.selectedRowId ?? m.templateButtonReplyMessage?.selectedId;
    const texto = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.buttonsResponseMessage?.selectedDisplayText ?? "";
    const entrada: Entrada = { telefone };
    if (botaoId) entrada.botaoId = String(botaoId);
    if (texto) entrada.texto = String(texto);
    if (loc && Number.isFinite(loc.degreesLatitude) && Number.isFinite(loc.degreesLongitude)) {
      entrada.localizacao = { lat: loc.degreesLatitude, lng: loc.degreesLongitude, endereco: loc.address ?? undefined, nome: loc.name ?? undefined };
    }
    if (!entrada.texto && !entrada.botaoId && !entrada.localizacao) continue; // figurinha, áudio, reação…
    saida.push({ entrada, waId: String(d.key.id ?? ""), nome: d.pushName ?? null });
  }
  return saida;
}

/** Sem botões na Evolution: as opções vão numeradas no fim do texto ("*1* – Aceitar"). */
export function textoComOpcoes(s: Pick<Saida, "texto" | "opcoes" | "rotuloLista">): string {
  if (!s.opcoes?.length) return s.texto;
  const linhas = s.opcoes.map((o, i) => `*${i + 1}* – ${o.titulo}${o.descricao ? ` (${o.descricao})` : ""}`);
  return `${s.texto}\n\n${s.rotuloLista ? `${s.rotuloLista}. ` : ""}Responda com o número:\n${linhas.join("\n")}`;
}

/** "1", "1.", "opção 1" → id da 1ª opção enviada por último a este número. Qualquer outro texto segue como está. */
export function traduzirResposta(texto: string | undefined, opcoes: Opcao[] | null | undefined): string | null {
  const m = String(texto ?? "").trim().toLowerCase().match(/^(?:op[cç][aã]o\s*)?(\d{1,2})[.)]?$/);
  if (!m || !opcoes?.length) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= opcoes.length ? opcoes[n - 1].id : null;
}

export const evolutionConfigurada = () => !!(process.env.EVOLUTION_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCIA);

/** Envia texto pela Evolution API v2 (POST /message/sendText/{instância}). */
export async function enviarTextoEvolution(numero: string, texto: string): Promise<{ ok: boolean; id?: string | null; erro?: string }> {
  const base = String(process.env.EVOLUTION_URL ?? "").replace(/\/$/, "");
  try {
    const resp = await fetch(`${base}/message/sendText/${encodeURIComponent(process.env.EVOLUTION_INSTANCIA ?? "")}`, {
      method: "POST",
      headers: { apikey: process.env.EVOLUTION_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ number: numero, text: texto }),
      signal: AbortSignal.timeout(15_000),
    });
    const corpo: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, erro: String(corpo?.response?.message ?? corpo?.message ?? corpo?.error ?? `HTTP ${resp.status}`) };
    return { ok: true, id: corpo?.key?.id ?? null };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
