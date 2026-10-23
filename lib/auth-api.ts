import { supabaseAdmin } from "./supabase-admin";

export type Perfil = "admin" | "planejamento" | "consulta";
export type UsuarioApi = { id: string; nome: string; perfil: Perfil };

/** Lê o usuário do token enviado pelo painel (Authorization: Bearer <access_token>) e confere o perfil. */
export async function usuarioDaRequisicao(req: Request, perfis: Perfil[]): Promise<UsuarioApi | Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ erro: "Faça login para continuar." }, { status: 401 });
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return Response.json({ erro: "Sessão expirada. Entre novamente." }, { status: 401 });
  const { data: perfil } = await db.from("profiles").select("id,nome,perfil,ativo").eq("id", data.user.id).maybeSingle();
  if (!perfil?.ativo || !perfis.includes(perfil.perfil)) return Response.json({ erro: "Seu perfil não permite esta ação." }, { status: 403 });
  return { id: perfil.id, nome: perfil.nome, perfil: perfil.perfil };
}

export const erroJson = (mensagem: string, status = 400) => Response.json({ erro: mensagem }, { status });

/** Cliente Supabase agindo como o usuário logado (RLS e auth.uid() valem). */
export async function clienteDoUsuario(req: Request) {
  const { createClient } = await import("@supabase/supabase-js");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
