import { supabaseAdmin } from "@/lib/supabase-admin";
import { cookieDoFornecedor, cookieSemFornecedor } from "@/lib/acesso-fornecedor";
import { dentroDoLimite, ipDe, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

const INCORRETO = "E-mail ou código de acesso incorreto. Confira com o planejamento.";

/**
 * Login do portal do fornecedor: e-mail cadastrado + código de acesso de 6 dígitos.
 * Com `token` (aberto pelo link do portal), o e-mail precisa ser desse fornecedor; sem ele, o e-mail encontra o portal.
 */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const email = String(corpo?.email ?? "").trim().toLowerCase();
  const codigo = String(corpo?.codigo ?? "").replace(/\D/g, "");
  const token = corpo?.token == null || corpo.token === "" ? null : corpo.token;
  if (token !== null && !tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erroJson("Digite o e-mail cadastrado.");
  if (codigo.length !== 6) return erroJson("A senha é o código de acesso de 6 números.");
  if (!(await dentroDoLimite(`portal-entrar-ip:${ipDe(req)}`, 10, 900)) || !(await dentroDoLimite(`portal-entrar:${email}`, 5, 900))) {
    return erroJson("Muitas tentativas. Aguarde 15 minutos ou peça o código ao planejamento.", 429);
  }
  try {
    const db = supabaseAdmin();
    const consulta = db.from("fornecedores").select("id,nome,email,ativo,token_portal,codigo_acesso");
    const { data: f, error } = await (token ? consulta.eq("token_portal", token) : consulta.eq("email", email)).maybeSingle();
    if (error) throw new Error(error.message.includes("email") ? "O banco ainda não tem o login do portal. Rode supabase/013_login_fornecedor.sql no Supabase." : error.message);
    if (token && !f) return erroJson("Este link não vale mais. Peça um novo ao planejamento.", 404);
    if (f && f.ativo && !f.email && token) return erroJson("Seu e-mail ainda não foi cadastrado. Peça ao planejamento para cadastrá-lo.", 403);
    if (!f?.ativo || f.email !== email || f.codigo_acesso !== codigo) return erroJson(INCORRETO, 403);
    return Response.json({ ok: true, token: f.token_portal, fornecedor: f.nome }, { headers: { "Set-Cookie": cookieDoFornecedor(req, f) } });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Sair: desconecta este fornecedor do aparelho. */
export async function DELETE(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieSemFornecedor(req, token) } });
}
