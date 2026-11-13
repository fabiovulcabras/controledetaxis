import { supabaseAdmin } from "@/lib/supabase-admin";
import { clienteDoUsuario, erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { avisoFornecedor } from "@/lib/espelho";
import { despacharSaidas } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

const migracao = (m: string) => /espelho|fn_gerar|fn_reemitir|fn_marcar_pago/.test(m) && /does not exist|could not find/i.test(m)
  ? "O banco ainda não tem o espelho. Rode supabase/015_espelho.sql no Supabase." : m;

/**
 * Ações do planejamento que avisam o fornecedor: gerar o espelho, reenviar depois das contestações e registrar o pagamento.
 * As funções do banco rodam com a sessão do usuário (fica registrado quem fez).
 */
export async function POST(req: Request) {
  const u = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (u instanceof Response) return u;
  const corpo = await req.json().catch(() => null);
  const acao = String(corpo?.acao ?? "");
  try {
    const db = await clienteDoUsuario(req);
    let espelhoId = String(corpo?.espelhoId ?? "");
    let aviso: "gerado" | "reemitido" | "pago";
    if (acao === "gerar") {
      const { data, error } = await db.rpc("fn_gerar_espelho", { p_fornecedor: corpo?.fornecedorId, p_competencia: corpo?.competencia });
      if (error) return erroJson(migracao(error.message));
      espelhoId = data as string; aviso = "gerado";
    } else if (acao === "reemitir") {
      const { error } = await db.rpc("fn_reemitir_espelho", { p_espelho: espelhoId });
      if (error) return erroJson(migracao(error.message));
      aviso = "reemitido";
    } else if (acao === "pago") {
      const { error } = await db.rpc("fn_marcar_pago", { p_espelho: espelhoId, p_data: corpo?.data });
      if (error) return erroJson(migracao(error.message));
      aviso = "pago";
    } else {
      return erroJson("Ação desconhecida.");
    }
    const admin = supabaseAdmin();
    const saidas = await avisoFornecedor(admin, espelhoId, aviso);
    await despacharSaidas(admin, saidas).catch((e) => console.error("Aviso do espelho falhou", e));
    return Response.json({ ok: true, espelhoId, avisos: saidas.length });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
