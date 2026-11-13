import { supabaseAdmin } from "@/lib/supabase-admin";
import { aparelhoConectado } from "@/lib/acesso-fornecedor";
import { dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { formatarDataHora, brl, lerValor } from "@/lib/datas";
import { avisoPlanejamento } from "@/lib/espelho";
import { despacharSaidas } from "@/lib/whatsapp/transporte";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/;

async function fornecedorConectado(req: Request, token: unknown) {
  if (!tokenValido(token)) return { erro: erroJson("Link inválido.", 404) };
  const { data: forn, error } = await supabaseAdmin().from("fornecedores").select("id,nome,ativo,token_portal,codigo_acesso").eq("token_portal", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!forn?.ativo) return { erro: erroJson("Este link não vale mais. Peça um novo ao planejamento.", 404) };
  if (!aparelhoConectado(req, forn)) return { erro: Response.json({ erro: "Entre com seu e-mail e código de acesso.", login: true }, { status: 401 }) };
  return { forn };
}

/** Espelhos do fornecedor (lista) ou um espelho com itens, extras e histórico (com ?id=). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (!(await dentroDoLimite(`portal-espelhos:${q.get("token")}`, 60, 60))) return muitasTentativas();
  try {
    const r = await fornecedorConectado(req, q.get("token"));
    if (r.erro) return r.erro;
    const db = supabaseAdmin();
    const id = q.get("id");
    if (!id) {
      const { data, error } = await db.from("espelhos").select("id,competencia,status,total,versao,prazo_em,aprovacao")
        .eq("fornecedor_id", r.forn.id).order("competencia", { ascending: false }).limit(24);
      if (error) return Response.json({ espelhos: [], aviso: "migracao" });
      return Response.json({ espelhos: data ?? [] });
    }
    if (!UUID.test(id)) return erroJson("Espelho não encontrado.", 404);
    const { data: esp } = await db.from("espelhos").select("*").eq("id", id).eq("fornecedor_id", r.forn.id).maybeSingle();
    if (!esp) return erroJson("Espelho não encontrado.", 404);
    const [{ data: itens }, { data: extras }, { data: eventos }] = await Promise.all([
      db.from("espelho_itens").select("*, corridas(protocolo,data_hora_prevista,origem,destino,qtd_passageiros,token_fornecedor,solicitantes(nome))").eq("espelho_id", id),
      db.from("corrida_extras").select("corrida_id,tipo,descricao,valor,status,motivo_recusa").eq("espelho_id", id),
      db.from("espelho_eventos").select("origem,tipo,descricao,criado_em").eq("espelho_id", id).order("criado_em"),
    ]);
    const lista = (itens ?? []).sort((a: any, b: any) => String(a.corridas?.data_hora_prevista).localeCompare(String(b.corridas?.data_hora_prevista)));
    return Response.json({
      fornecedor: r.forn.nome,
      espelho: { id: esp.id, competencia: esp.competencia, status: esp.status, versao: esp.versao, total: Number(esp.total), prazo_em: esp.prazo_em,
        prazo: esp.prazo_em ? formatarDataHora(esp.prazo_em) : null, aprovacao: esp.aprovacao, aprovado_em: esp.aprovado_em,
        nf_numero: esp.nf_numero, nf_valor: esp.nf_valor != null ? Number(esp.nf_valor) : null, nf_enviada_em: esp.nf_enviada_em, pago_em: esp.pago_em },
      itens: lista.map((i: any) => ({
        id: i.id, protocolo: i.corridas?.protocolo, quando: i.corridas ? formatarDataHora(i.corridas.data_hora_prevista) : "",
        origem: i.corridas?.origem, destino: i.corridas?.destino, passageiros: i.corridas?.qtd_passageiros, solicitante: i.corridas?.solicitantes?.nome ?? "—",
        link: i.corridas?.token_fornecedor ? `/f/${i.corridas.token_fornecedor}` : null,
        valor_informado: i.valor_informado != null ? Number(i.valor_informado) : null, valor_base: Number(i.valor_base), base_origem: i.base_origem,
        valor_extras: Number(i.valor_extras), valor_final: Number(i.valor_final), ajuste_obs: i.ajuste_obs,
        contestacao_status: i.contestacao_status, contestacao_motivo: i.contestacao_motivo,
        contestacao_valor: i.contestacao_valor != null ? Number(i.contestacao_valor) : null, contestacao_resposta: i.contestacao_resposta,
        extras: (extras ?? []).filter((x: any) => x.corrida_id === i.corrida_id).map((x: any) => ({ tipo: x.tipo, descricao: x.descricao, valor: Number(x.valor), status: x.status, motivo_recusa: x.motivo_recusa })),
      })),
      eventos: (eventos ?? []).map((e: any) => ({ ...e, quando: formatarDataHora(e.criado_em) })),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}

/** Fornecedor aprova o espelho ou contesta itens: { token, id, acao: "aprovar" | "contestar", itens?: [{ id, motivo, valor }] }. */
export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  if (!(await dentroDoLimite(`portal-espelhos-acao:${corpo?.token}`, 20, 600))) return muitasTentativas();
  try {
    const r = await fornecedorConectado(req, corpo?.token);
    if (r.erro) return r.erro;
    const id = String(corpo?.id ?? "");
    const db = supabaseAdmin();
    const { data: esp } = UUID.test(id) ? await db.from("espelhos").select("id,total").eq("id", id).eq("fornecedor_id", r.forn.id).maybeSingle() : { data: null };
    if (!esp) return erroJson("Espelho não encontrado.", 404);
    let aviso: string;
    if (corpo?.acao === "aprovar") {
      const { error } = await db.rpc("fn_aprovar_espelho", { p_espelho: id, p_origem: "fornecedor" });
      if (error) return erroJson(error.message);
      aviso = `aprovado pelo fornecedor (${brl(Number(esp.total))}). Aguardando a NF.`;
    } else if (corpo?.acao === "contestar") {
      const itens = Array.isArray(corpo?.itens) ? corpo.itens.slice(0, 500).map((i: any) => ({ id: String(i?.id ?? ""), motivo: String(i?.motivo ?? "").trim(), valor: lerValor(String(i?.valor ?? "")) })) : [];
      if (itens.some((i: any) => i.valor == null)) return erroJson("Informe o valor que você entende correto em cada item contestado.");
      const { error } = await db.rpc("fn_contestar_espelho", { p_espelho: id, p_itens: itens });
      if (error) return erroJson(error.message);
      aviso = `o fornecedor contestou ${itens.length} item(ns). Decida cada um e reenvie o espelho.`;
    } else {
      return erroJson("Ação desconhecida.");
    }
    await despacharSaidas(db, await avisoPlanejamento(db, id, aviso)).catch((e) => console.error("Aviso ao planejamento falhou", e));
    return Response.json({ ok: true });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
