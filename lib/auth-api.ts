import { supabaseAdmin } from "./supabase-admin";

export type Perfil = "admin" | "planejamento" | "consulta";
export type UsuarioApi = { id: string; nome: string; perfil: Perfil };

/** Lê o usuário do token enviado pelo painel (Authorization: Bearer <access_token>) e confere o perfil. */
export async function usuarioDaRequisicao(req: Request, perfis: Perfil[]): Promise<UsuarioApi | Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ erro: "Faça login para continuar." }, { status: 401 });
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) {
      // Chave de serviço errada (de outro projeto, ou a anon no lugar da service role) também cai aqui
      const chaveErrada = /invalid api key|jwt|signature/i.test(error?.message ?? "");
      return Response.json({ erro: chaveErrada
        ? `O servidor não conseguiu validar a sessão (${error?.message}). Confira se SUPABASE_SERVICE_ROLE_KEY é a chave service_role do mesmo projeto.`
        : "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    const { data: perfil, error: erroPerfil } = await db.from("profiles").select("id,nome,perfil,ativo").eq("id", data.user.id).maybeSingle();
    if (erroPerfil) return Response.json({ erro: `Não foi possível ler seu perfil: ${erroPerfil.message}` }, { status: 500 });
    if (!perfil?.ativo || !perfis.includes(perfil.perfil)) return Response.json({ erro: "Seu perfil não permite esta ação." }, { status: 403 });
    return { id: perfil.id, nome: perfil.nome, perfil: perfil.perfil };
  } catch (err) {
    return Response.json({ erro: err instanceof Error ? err.message : "Erro ao validar o acesso." }, { status: 500 });
  }
}

/** Mensagem de erro legível para devolver ao painel. */
export function mensagemDeErro(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/relation .* does not exist|could not find the (table|function)/i.test(msg)) {
    return `${msg} — o banco parece incompleto. Rode supabase/schema.sql no SQL Editor do Supabase.`;
  }
  return msg;
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
