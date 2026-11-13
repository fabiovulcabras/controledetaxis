import { supabaseAdmin } from "@/lib/supabase-admin";
import { dentroDoLimite, muitasTentativas } from "@/lib/links-api";
import { erroJson } from "@/lib/auth-api";
import { chavesConferem, chavesVapid, enviarPush } from "@/lib/webpush";

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
  if (r.ok) return Response.json({ ok: true });
  if (r.status === 401 || r.status === 403 || /BadJwtToken|credentials|VAPID/i.test(r.erro ?? "")) {
    const motivo = !chavesConferem(ch)
      ? "VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY na Vercel não são do mesmo par: copie as duas da mesma abertura de /api/push/gerar-chaves e faça redeploy."
      : "este aparelho foi inscrito com chaves antigas. Toque em Desativar e depois em Ativar notificações.";
    return erroJson(`O serviço de notificações recusou a identificação do servidor: ${motivo}`, 502);
  }
  return erroJson(`O serviço de notificações recusou (${r.erro}).`, 502);
}
