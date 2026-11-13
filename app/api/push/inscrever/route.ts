import { supabaseAdmin } from "@/lib/supabase-admin";
import { dentroDoLimite, ipDe, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { aparelhoConectado, aparelhoDoFornecedor } from "@/lib/acesso-fornecedor";

export const dynamic = "force-dynamic";

/**
 * Inscreve este aparelho para receber notificações.
 * tipo solicitante: token = link de pedido da pessoa; fornecedor: token = link do portal ou de uma corrida;
 * planejamento: usuário logado no painel (Authorization: Bearer).
 */
export async function POST(req: Request) {
  if (!(await dentroDoLimite(`push-inscrever:${ipDe(req)}`, 20, 600))) return muitasTentativas();
  const corpo = await req.json().catch(() => null);
  const ins = corpo?.inscricao;
  const endpoint = String(ins?.endpoint ?? "");
  const p256dh = String(ins?.keys?.p256dh ?? ""), auth = String(ins?.keys?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return erroJson("Inscrição inválida.");
  const tipo = String(corpo?.tipo ?? "");
  try {
    const db = supabaseAdmin();
    const linha: Record<string, unknown> = { endpoint, p256dh, auth, tipo, solicitante_id: null, fornecedor_id: null, usuario_id: null, aparelho: String(req.headers.get("user-agent") ?? "").slice(0, 200), falhas: 0 };
    if (tipo === "solicitante") {
      if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
      const { data } = await db.from("solicitantes").select("id,ativo").eq("token_pedido", corpo.token).maybeSingle();
      if (!data?.ativo) return erroJson("Este link não vale mais.", 404);
      linha.solicitante_id = data.id;
    } else if (tipo === "fornecedor") {
      if (!tokenValido(corpo?.token)) return erroJson("Link inválido.", 404);
      const { data: f } = await db.from("fornecedores").select("id,ativo,token_portal,codigo_acesso").eq("token_portal", corpo.token).maybeSingle();
      // Pelo portal, só o aparelho que entrou com e-mail e código. Pelo link de uma corrida, só o aparelho já identificado como do fornecedor (o solicitante também vê esse link)
      const { data: c } = f ? { data: null } : await db.from("corridas").select("fornecedor_id").eq("token_fornecedor", corpo.token).maybeSingle();
      const fornecedorId = f ? (f.ativo && aparelhoConectado(req, f) ? f.id : null) : c?.fornecedor_id && await aparelhoDoFornecedor(req, c.fornecedor_id) ? c.fornecedor_id : null;
      if (!fornecedorId) return erroJson("Este link não vale mais.", 404);
      linha.fornecedor_id = fornecedorId;
    } else if (tipo === "planejamento") {
      const u = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
      if (u instanceof Response) return u;
      linha.usuario_id = u.id;
    } else {
      return erroJson("Tipo inválido.");
    }
    const { error } = await db.from("push_inscricoes").upsert(linha, { onConflict: "endpoint" });
    if (error) throw new Error(error.message.includes("push_inscricoes") ? "O banco ainda não tem as notificações. Rode supabase/012_notificacoes_push.sql no Supabase." : error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
