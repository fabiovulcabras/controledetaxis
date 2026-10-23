import { createHmac, timingSafeEqual } from "node:crypto";
import type { Entrada, Saida } from "../bot/tipos";
import { limparParametro } from "./templates";

/** Limites da Cloud API para mensagens interativas. */
const corta = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Corpo da chamada POST /{phone-number-id}/messages para uma saída. */
export function payloadMeta(s: Saida, usarTemplate: boolean): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: s.para };
  if (usarTemplate && s.template) {
    const components: any[] = [];
    if (s.template.parametros.length) {
      components.push({ type: "body", parameters: s.template.parametros.map((p) => ({ type: "text", text: limparParametro(p) })) });
    }
    (s.template.botoes ?? []).forEach((payload, i) => {
      components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] });
    });
    return { ...base, type: "template", template: { name: s.template.nome, language: { code: "pt_BR" }, components } };
  }
  const opcoes = s.opcoes ?? [];
  if (opcoes.length && !s.rotuloLista && opcoes.length <= 3) {
    return {
      ...base, type: "interactive",
      interactive: {
        type: "button", body: { text: corta(s.texto, 1024) },
        action: { buttons: opcoes.map((o) => ({ type: "reply", reply: { id: corta(o.id, 256), title: corta(o.titulo, 20) } })) },
      },
    };
  }
  if (opcoes.length) {
    return {
      ...base, type: "interactive",
      interactive: {
        type: "list", body: { text: corta(s.texto, 1024) },
        action: {
          button: corta(s.rotuloLista ?? "Ver opções", 20),
          sections: [{ title: "Opções", rows: opcoes.slice(0, 10).map((o) => ({ id: corta(o.id, 200), title: corta(o.titulo, 24), ...(o.descricao ? { description: corta(o.descricao, 72) } : {}) })) }],
        },
      },
    };
  }
  return { ...base, type: "text", text: { body: corta(s.texto, 4096), preview_url: false } };
}

/** Converte o corpo do webhook da Meta em entradas para o bot. Ignora avisos de status (entregue, lido). */
export function lerWebhook(corpo: any): { entrada: Entrada; waId: string; bruto: any }[] {
  const resultado: { entrada: Entrada; waId: string; bruto: any }[] = [];
  for (const entry of corpo?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const entrada: Entrada = { telefone: String(m.from ?? "") };
        if (m.type === "text") entrada.texto = m.text?.body ?? "";
        else if (m.type === "interactive") entrada.botaoId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
        else if (m.type === "button") entrada.botaoId = m.button?.payload ?? m.button?.text;
        else if (m.type === "location") entrada.localizacao = { lat: m.location?.latitude, lng: m.location?.longitude, endereco: m.location?.address, nome: m.location?.name };
        else entrada.texto = ""; // áudio, imagem etc.: o bot repete a pergunta
        resultado.push({ entrada, waId: String(m.id ?? ""), bruto: m });
      }
    }
  }
  return resultado;
}

/** Atualizações de entrega (sent, delivered, read, failed) para registrar no histórico. */
export function lerStatusEntrega(corpo: any): { waId: string; status: string; erro?: string }[] {
  const lista: { waId: string; status: string; erro?: string }[] = [];
  for (const entry of corpo?.entry ?? []) for (const change of entry?.changes ?? []) for (const st of change?.value?.statuses ?? []) {
    lista.push({ waId: String(st.id), status: String(st.status), erro: st.errors?.[0]?.title ?? st.errors?.[0]?.message });
  }
  return lista;
}

/** Confere o cabeçalho X-Hub-Signature-256 com o App Secret. */
export function assinaturaValida(corpoBruto: string, cabecalho: string | null, segredo: string | undefined): boolean {
  if (!segredo) return false;
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from(`sha256=${createHmac("sha256", segredo).update(corpoBruto, "utf8").digest("hex")}`);
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
