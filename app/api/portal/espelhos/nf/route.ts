import { supabaseAdmin } from "@/lib/supabase-admin";
import { aparelhoConectado } from "@/lib/acesso-fornecedor";
import { dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { apagarArquivo, guardarArquivo } from "@/lib/arquivos";
import { erroArquivo } from "@/lib/extras";
import { brl, lerValor } from "@/lib/datas";
import { avisoPlanejamento } from "@/lib/espelho";
import { despacharSaidas } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

/** Fornecedor envia a NF do espelho aprovado (multipart: token, id, numero, valor, arquivo PDF). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return erroJson("Envio inválido.");
  const token = form.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`portal-nf:${token}`, 10, 600))) return muitasTentativas();
  try {
    const db = supabaseAdmin();
    const { data: forn } = await db.from("fornecedores").select("id,ativo,token_portal,codigo_acesso").eq("token_portal", token).maybeSingle();
    if (!forn?.ativo) return erroJson("Este link não vale mais.", 404);
    if (!aparelhoConectado(req, forn)) return Response.json({ erro: "Entre com seu e-mail e código de acesso.", login: true }, { status: 401 });
    const id = String(form.get("id") ?? "");
    const { data: esp } = /^[0-9a-f-]{36}$/.test(id) ? await db.from("espelhos").select("id,status,total").eq("id", id).eq("fornecedor_id", forn.id).maybeSingle() : { data: null };
    if (!esp) return erroJson("Espelho não encontrado.", 404);
    if (!["aprovado", "nf_enviada"].includes(esp.status)) return erroJson("A NF é enviada depois que o espelho é aprovado, e só até o pagamento.");
    const numero = String(form.get("numero") ?? "").trim();
    const valor = lerValor(String(form.get("valor") ?? ""));
    if (!numero) return erroJson("Informe o número da NF.");
    if (valor == null || valor <= 0) return erroJson("Informe o valor da NF.");
    const arquivo = form.get("arquivo");
    const problema = erroArquivo(arquivo instanceof File ? arquivo : null, true);
    if (problema) return erroJson(problema);
    const caminho = await guardarArquivo(`nf/${esp.id}`, arquivo as File);
    const { error } = await db.rpc("fn_registrar_nf", { p_espelho: esp.id, p_numero: numero, p_valor: valor, p_arquivo: caminho });
    if (error) { await apagarArquivo(caminho); return erroJson(error.message); }
    const diferenca = Math.abs(valor - Number(esp.total)) >= 0.01;
    await despacharSaidas(db, await avisoPlanejamento(db, esp.id,
      `NF ${numero} de ${brl(valor)} recebida${diferenca ? ` — DIFERENTE do espelho (${brl(Number(esp.total))})` : ", igual ao espelho"}. Registre o pagamento quando pagar.`)).catch(() => null);
    return Response.json({ ok: true, diferente: diferenca });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
