import { createClient } from "@supabase/supabase-js";
import { modoEnvio } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

type Item = { ok: boolean; item: string; detalhe?: string };

/** Papel gravado numa chave JWT do Supabase (anon / service_role). Chaves novas (sb_secret_…) não são JWT. */
function papelDaChave(chave: string): string | null {
  if (chave.startsWith("sb_secret_")) return "service_role";
  if (chave.startsWith("sb_publishable_")) return "anon";
  try { return JSON.parse(Buffer.from(chave.split(".")[1], "base64url").toString("utf8")).role ?? null; } catch { return null; }
}

/** Diagnóstico da configuração. Não mostra nenhuma chave, só se está tudo no lugar. Abra /api/saude no navegador. */
export async function GET() {
  const itens: Item[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  itens.push({ ok: !!url, item: "NEXT_PUBLIC_SUPABASE_URL configurada" });
  itens.push({ ok: !!anon, item: "NEXT_PUBLIC_SUPABASE_ANON_KEY configurada" });
  const papel = servico ? papelDaChave(servico) : null;
  itens.push({
    ok: !!servico && papel === "service_role", item: "SUPABASE_SERVICE_ROLE_KEY configurada com a chave service_role",
    detalhe: !servico ? "Falta a variável no servidor. Copie em Supabase › Project Settings › API Keys (service_role / secret) e faça novo deploy."
      : papel !== "service_role" ? `A chave informada é do tipo "${papel ?? "desconhecido"}". Use a service_role (secret), não a anon.` : undefined,
  });

  if (url && servico) {
    const db = createClient(url, servico, { auth: { persistSession: false, autoRefreshToken: false } });
    const tabelas = ["profiles", "solicitantes", "fornecedores", "corridas", "mensagens", "conversas_bot", "parametros"];
    for (const t of tabelas) {
      const { error } = await db.from(t).select("*", { head: true });
      itens.push({ ok: !error, item: `Tabela ${t}`, detalhe: error ? `${error.message}${/does not exist|could not find/i.test(error.message) ? " — rode supabase/schema.sql" : ""}` : undefined });
    }
    const { error: erroFn } = await db.rpc("fn_mudar_status", { p_corrida: "00000000-0000-0000-0000-000000000000", p_status: null, p_origem: "sistema", p_obs: null, p_campos: {} });
    const fnOk = !!erroFn && /não encontrada/i.test(erroFn.message);
    itens.push({ ok: fnOk, item: "Função fn_mudar_status", detalhe: fnOk ? undefined : erroFn?.message ?? "Resposta inesperada" });

    const { error: erroLinks } = await db.from("solicitantes").select("token_pedido", { head: true, count: "exact" });
    itens.push({ ok: !erroLinks, item: "Links de pedido (migração 002)", detalhe: erroLinks ? "Rode supabase/002_links_whatsapp.sql no SQL Editor." : undefined });
    const { error: erro003 } = await db.rpc("fn_consumir_limite", { p_chave: "saude", p_limite: 1000, p_janela_seg: 60 });
    itens.push({ ok: !erro003, item: "Melhorias (migração 003)", detalhe: erro003 ? "Rode supabase/003_melhorias.sql no SQL Editor." : undefined });

    const { data: fornecedores } = await db.from("fornecedores").select("id").eq("ativo", true);
    itens.push({ ok: (fornecedores?.length ?? 0) > 0, item: "Pelo menos um fornecedor ativo" });
    const { data: plan } = await db.from("parametros").select("valor").eq("chave", "planejamento_telefones").maybeSingle();
    itens.push({ ok: !!plan?.valor?.trim(), item: "Número do planejamento em Parâmetros", detalhe: plan?.valor?.trim() ? undefined : "Opcional, mas sem ele o planejamento não recebe avisos." });
  }

  const modo = modoEnvio();
  itens.push({ ok: true, item: `Envio de WhatsApp: ${modo === "whatsapp" ? "Cloud API da Meta" : "simulado (mensagens só gravadas no histórico; avisos pelos botões de WhatsApp)"}` });
  if (process.env.WHATSAPP_MODO === "meta" && modo !== "whatsapp") {
    itens.push({ ok: false, item: "WHATSAPP_MODO=meta, mas falta WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID" });
  }

  return Response.json({ ok: itens.every((i) => i.ok), itens }, { headers: { "Cache-Control": "no-store" } });
}
