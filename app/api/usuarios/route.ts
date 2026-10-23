import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/** Convida um usuário para o painel (e-mail com link para criar a senha) e define o perfil. Só administradores. */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const email = String(corpo?.email ?? "").trim().toLowerCase();
  const nome = String(corpo?.nome ?? "").trim();
  const perfil = ["admin", "planejamento", "consulta"].includes(corpo?.perfil) ? corpo.perfil : "consulta";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroJson("Informe um e-mail válido.");
  if (!nome) return erroJson("Informe o nome.");

  try {
  const db = supabaseAdmin();
  const origem = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo: `${origem}/redefinir-senha` });
  if (error || !data.user) return erroJson(error?.message?.includes("already") ? "Este e-mail já tem acesso." : error?.message ?? "Não foi possível convidar.");
  await db.from("profiles").update({ nome, perfil }).eq("id", data.user.id);
  return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
