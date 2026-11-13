import { supabaseAdmin } from "@/lib/supabase-admin";
import { aparelhoDoFornecedor } from "@/lib/acesso-fornecedor";
import { corridaPorTokenFornecedor, dentroDoLimite, muitasTentativas, repoServidor, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { apagarArquivo, guardarArquivo } from "@/lib/arquivos";
import { CORRIDA_ACEITA_EXTRA, TIPOS_EXTRA, erroArquivo, tipoExtraValido } from "@/lib/extras";
import { brl, lerValor } from "@/lib/datas";
import { alertar } from "@/lib/bot/acoes";
import { despacharSaidas } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";

/**
 * Fornecedor lança um extra (pedágio, espera, km a mais, parada extra) numa corrida concluída, com comprovante.
 * Formulário multipart: token (link da corrida), tipo, valor, descricao, arquivo. Só do aparelho conectado ao fornecedor,
 * e só até a corrida entrar no espelho do mês.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return erroJson("Envio inválido.");
  const token = form.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`fornecedor-extra:${token}`, 10, 600))) return muitasTentativas();
  try {
    const c = await corridaPorTokenFornecedor(token);
    if (!c) return erroJson("Este link não vale mais.", 404);
    if (!(await aparelhoDoFornecedor(req, c.fornecedor_id))) return erroJson("Só o fornecedor pode lançar extras. Entre no seu portal ou digite o código de acesso.", 403);
    if (!CORRIDA_ACEITA_EXTRA.includes(c.status)) return erroJson("Extras só podem ser lançados depois de concluir a corrida.");
    const tipo = form.get("tipo");
    if (!tipoExtraValido(tipo)) return erroJson("Escolha o tipo do extra.");
    const valor = lerValor(String(form.get("valor") ?? ""));
    if (valor == null || valor <= 0) return erroJson("Informe o valor do extra.");
    if (valor > 2000) return erroJson("Valor muito alto para um extra. Confira o valor.");
    const descricao = String(form.get("descricao") ?? "").trim().slice(0, 300);
    if (tipo === "outro" && !descricao) return erroJson("Descreva o extra.");
    const arquivo = form.get("arquivo");
    const problema = erroArquivo(arquivo instanceof File ? arquivo : null);
    if (problema) return erroJson(problema);

    const db = supabaseAdmin();
    const { data: noEspelho } = await db.from("espelho_itens").select("id").eq("corrida_id", c.id).maybeSingle();
    if (noEspelho) return erroJson("Esta corrida já está no espelho do mês. Para cobrar um extra, conteste o item no espelho.");

    const caminho = await guardarArquivo(`extras/${c.id}`, arquivo as File);
    const { error } = await db.from("corrida_extras").insert({ corrida_id: c.id, tipo, valor, descricao: descricao || null, comprovante: caminho });
    if (error) {
      await apagarArquivo(caminho);
      throw new Error(error.message.includes("corrida_extras") ? "O banco ainda não tem os extras. Rode supabase/015_espelho.sql no Supabase." : error.message);
    }
    // Avisa o planejamento (WhatsApp, e-mail e notificação, conforme configurado)
    await despacharSaidas(db, await alertar(repoServidor(), c, `Extra lançado: ${TIPOS_EXTRA[tipo]} de ${brl(valor)}. Aprove ou recuse no painel.`)).catch(() => null);
    return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
