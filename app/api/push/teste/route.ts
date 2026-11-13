import { supabaseAdmin } from "@/lib/supabase-admin";
import { dentroDoLimite, muitasTentativas } from "@/lib/links-api";
import { erroJson } from "@/lib/auth-api";
import { chavesVapid, enviarPush } from "@/lib/webpush";

export const dynamic = "force-dynamic";

/** Manda uma notificação de teste para este aparelho. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const endpoint = String(corpo?.endpoint ?? "");
  const url = typeof corpo?.url === "string" && /^\/[^/]/.test(corpo.url) ? corpo.url.slice(0, 200) : "/";
  if (!(await dentroDoLimite(`push-teste:${endpoint.slice(-40)}`, 5, 300))) return muitasTentativas();
  const ch = chavesVapid();
  if (!ch) return erroJson("Notificações não configuradas.", 503);
  const { data: insc } = await supabaseAdmin().from("push_inscricoes").select("endpoint,p256dh,auth").eq("endpoint", endpoint).maybeSingle();
  if (!insc) return erroJson("Este aparelho não está inscrito.", 404);
  const r = await enviarPush(insc, { titulo: "Notificações ativas", corpo: "Tudo certo: você vai receber aqui o andamento das corridas.", url, tag: "teste" }, ch);
  return r.ok ? Response.json({ ok: true }) : erroJson(`O serviço de notificações recusou (${r.erro}).`, 502);
}
