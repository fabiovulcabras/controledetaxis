import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/** Desativa as notificações deste aparelho (o endereço da inscrição só é conhecido pelo próprio aparelho). */
export async function POST(req: Request) {
  const endpoint = String((await req.json().catch(() => null))?.endpoint ?? "");
  if (!/^https:\/\//.test(endpoint)) return erroJson("Inscrição inválida.");
  await supabaseAdmin().from("push_inscricoes").delete().eq("endpoint", endpoint);
  return Response.json({ ok: true });
}
