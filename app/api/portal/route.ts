import { supabaseAdmin } from "@/lib/supabase-admin";
import { cookieDoFornecedor } from "@/lib/acesso-fornecedor";
import { dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { STATUS, type StatusCorrida } from "@/lib/status";
import { brl, formatarDataHora } from "@/lib/datas";
import { buscarPaginado, periodoExportacao } from "@/lib/exportacao-fornecedor";

const ATIVAS = ["enviada", "sem_resposta", "aceita", "em_andamento"];
const LIMITE_ENCERRADAS = 100;

export const dynamic = "force-dynamic";

/** Portal do fornecedor: todas as corridas dele, pelo link fixo (sem depender da mensagem de cada corrida). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`portal:${token}`, 60, 60))) return muitasTentativas();
  try {
    const db = supabaseAdmin();
    const { data: forn, error } = await db.from("fornecedores").select("id,nome,ativo").eq("token_portal", token).maybeSingle();
    if (error) throw new Error(error.message.includes("token_portal") ? "O banco ainda não tem o portal do fornecedor. Rode supabase/003_melhorias.sql no Supabase." : error.message);
    if (!forn?.ativo) return erroJson("Este link não vale mais. Peça um novo ao planejamento.", 404);
    // Período escolhido no topo do portal (padrão: últimos 45 dias). Vale para as encerradas e o valor concluído;
    // as corridas para responder e em andamento aparecem sempre, porque pedem ação do fornecedor.
    const q = new URL(req.url).searchParams;
    let inicio = new Date(Date.now() - 45 * 86400_000), fim = new Date(Date.now() + 366 * 86400_000);
    if (q.get("de") || q.get("ate")) {
      const p = periodoExportacao(q.get("de"), q.get("ate"));
      if ("erro" in p) return erroJson(p.erro, 400);
      ({ inicio, fim } = p);
    }
    const colunas = "id,protocolo,status,tipo,data_hora_prevista,origem,destino,solicitante_nome,valor_informado,token_fornecedor,prazo_resposta_em,observacoes";
    const [ativas, encerradas] = await Promise.all([
      db.from("corridas_lista").select(colunas).eq("fornecedor_id", forn.id).in("status", ATIVAS)
        .gte("data_hora_prevista", new Date(Date.now() - 45 * 86400_000).toISOString()).order("data_hora_prevista", { ascending: true }).limit(150),
      buscarPaginado<any>((de, ate) => db.from("corridas_lista").select(colunas).eq("fornecedor_id", forn.id).not("status", "in", `(${[...ATIVAS, "solicitada"].join(",")})`)
        .gte("data_hora_prevista", inicio.toISOString()).lt("data_hora_prevista", fim.toISOString())
        .order("data_hora_prevista", { ascending: false }).order("id").range(de, ate), 20000),
    ]);
    if (ativas.error) throw new Error(ativas.error.message);
    const item = (c: any) => ({
      protocolo: c.protocolo, status: c.status, status_rotulo: STATUS[c.status as StatusCorrida]?.rotulo ?? c.status,
      quando: formatarDataHora(c.data_hora_prevista), origem: c.origem, destino: c.destino, solicitante: c.solicitante_nome,
      valor: c.valor_informado != null ? brl(Number(c.valor_informado)) : null, link: `/f/${c.token_fornecedor}`, prazo_iso: c.prazo_resposta_em && ["enviada", "sem_resposta"].includes(c.status) ? c.prazo_resposta_em : null, observacoes: c.observacoes ?? null,
    });
    const lista = (ativas.data ?? []) as any[];
    const concluidas = encerradas.filter((c) => ["concluida", "validada", "contestada"].includes(c.status));
    // Abrir o portal identifica este aparelho como do fornecedor: os links /f/… passam a permitir responder
    return Response.json({
      fornecedor: forn.nome,
      responder: lista.filter((c) => ["enviada", "sem_resposta"].includes(c.status)).map(item),
      em_curso: lista.filter((c) => ["aceita", "em_andamento"].includes(c.status)).map(item),
      encerradas: encerradas.slice(0, LIMITE_ENCERRADAS).map(item),
      qtd_encerradas: encerradas.length,
      total_periodo: brl(concluidas.reduce((s: number, c: any) => s + Number(c.valor_informado ?? 0), 0)),
      qtd_concluidas: concluidas.length,
    }, { headers: { "Set-Cookie": cookieDoFornecedor(req, token) } });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
