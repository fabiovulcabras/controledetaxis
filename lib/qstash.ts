import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upstash QStash: guarda uma chamada HTTP para o futuro. Cada envio de corrida a um fornecedor agenda
 * POST /api/qstash/prazo para o fim do prazo de resposta; se ele não respondeu, a rota passa ao próximo da fila.
 * Como a Vercel encerra a função logo após responder, o "relógio" fica no QStash e não no servidor.
 *
 * Variáveis: QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY,
 * QSTASH_URL (opcional, padrão https://qstash.upstash.io) e NEXT_PUBLIC_APP_URL (endereço público do app).
 */

export const qstashConfigurado = () => !!process.env.QSTASH_TOKEN;

function urlDestino(): string | null {
  const base = process.env.QSTASH_DESTINO_URL || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return base ? `${base.replace(/\/$/, "")}/api/qstash/prazo` : null;
}

/** Agenda a verificação de uma tentativa para o instante do prazo. Devolve o id da mensagem no QStash. */
export async function agendarVerificacao(tentativaId: string, prazo: Date): Promise<string> {
  const destino = urlDestino();
  if (!destino) throw new Error("Defina NEXT_PUBLIC_APP_URL com o endereço público do app (o QStash precisa dele).");
  const quando = Math.max(Math.ceil(prazo.getTime() / 1000), Math.floor(Date.now() / 1000));
  const resp = await fetch(`${(process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "")}/v2/publish/${destino}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      "Upstash-Not-Before": String(quando),
      "Upstash-Retries": "3",
      // Mesmo prazo da mesma tentativa nunca é agendado duas vezes, mesmo com chamadas simultâneas
      "Upstash-Deduplication-Id": `prazo-${tentativaId}-${quando}`,
    },
    body: JSON.stringify({ tentativa_id: tentativaId }),
    signal: AbortSignal.timeout(10_000),
  });
  const corpo: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`QStash: ${corpo?.error ?? `HTTP ${resp.status}`}`);
  return String(corpo?.messageId ?? "");
}

/**
 * Agenda no QStash as tentativas pendentes que ainda não têm tarefa. Chamado depois de cada processamento
 * (webhook, pedido por link, painel), então toda corrida enviada a um fornecedor ganha o seu "despertador".
 * Sem QSTASH_TOKEN não faz nada (o agendador /api/cron/prazos continua cobrindo os prazos).
 */
export async function agendarPrazosPendentes(db: SupabaseClient): Promise<void> {
  if (!qstashConfigurado()) return;
  const { data, error } = await db.from("corrida_tentativas").select("id,prazo_em")
    .eq("status", "pendente").is("qstash_message_id", null).not("prazo_em", "is", null).limit(20);
  if (error) { console.error("QStash: não foi possível ler as tentativas (rodou a migração 006?)", error.message); return; }
  for (const t of data ?? []) {
    try {
      const id = await agendarVerificacao(t.id, new Date(t.prazo_em));
      await db.from("corrida_tentativas").update({ qstash_message_id: id || "agendado", qstash_agendado_em: new Date().toISOString() }).eq("id", t.id).is("qstash_message_id", null);
    } catch (err) {
      console.error("QStash: falha ao agendar o prazo", t.id, err instanceof Error ? err.message : err);
    }
  }
}

// ------------------------------------------------------------------ Assinatura das chamadas do QStash
const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ""; for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const deB64url = (t: string) => {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/**
 * Confere o cabeçalho Upstash-Signature (JWT HS256 assinado com a chave atual ou a próxima, em rotação),
 * a validade e o hash do corpo. Assim só o QStash consegue chamar a rota de prazo.
 */
export async function assinaturaQStashValida(assinatura: string | null, corpo: string, chaves: (string | undefined)[], agora = Date.now()): Promise<boolean> {
  const partes = (assinatura ?? "").split(".");
  if (partes.length !== 3) return false;
  const [cab, carga, sig] = partes;
  let claims: any;
  try { claims = JSON.parse(new TextDecoder().decode(deB64url(carga))); } catch { return false; }
  const seg = Math.floor(agora / 1000);
  if (claims?.iss !== "Upstash" || (claims.exp && seg > claims.exp + 30) || (claims.nbf && seg < claims.nbf - 30)) return false;
  const hash = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(corpo)));
  if (String(claims.body ?? "").replace(/=+$/, "") !== hash) return false;
  for (const chave of chaves.filter(Boolean) as string[]) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (await crypto.subtle.verify("HMAC", k, deB64url(sig), new TextEncoder().encode(`${cab}.${carga}`))) return true;
  }
  return false;
}
