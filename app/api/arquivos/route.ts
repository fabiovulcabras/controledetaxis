import { supabaseAdmin } from "@/lib/supabase-admin";
import { usuarioDaRequisicao, erroJson, mensagemDeErro } from "@/lib/auth-api";
import { linkArquivo } from "@/lib/arquivos";

export const dynamic = "force-dynamic";

/** Link temporário para o painel abrir um comprovante de extra ou uma NF. Só caminhos registrados no banco. */
export async function POST(req: Request) {
  const u = await usuarioDaRequisicao(req, ["admin", "planejamento", "consulta"]);
  if (u instanceof Response) return u;
  const caminho = String((await req.json().catch(() => null))?.caminho ?? "");
  if (!/^(extras|nf)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z]{3,4}$/.test(caminho)) return erroJson("Arquivo inválido.", 404);
  try {
    const db = supabaseAdmin();
    const [{ data: e }, { data: n }] = await Promise.all([
      db.from("corrida_extras").select("id").eq("comprovante", caminho).limit(1),
      db.from("espelhos").select("id").eq("nf_arquivo", caminho).limit(1),
    ]);
    if (!e?.length && !n?.length) return erroJson("Arquivo não encontrado.", 404);
    return Response.json({ url: await linkArquivo(caminho) });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
