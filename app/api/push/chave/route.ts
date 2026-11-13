import { chavesVapid } from "@/lib/webpush";

export const dynamic = "force-dynamic";

/** Chave pública VAPID, que o navegador usa para se inscrever. */
export async function GET() {
  const ch = chavesVapid();
  if (!ch) return Response.json({ erro: "Notificações ainda não configuradas (faltam VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY)." }, { status: 503 });
  return Response.json({ publica: ch.publica });
}
