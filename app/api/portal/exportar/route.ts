import { supabaseAdmin } from "@/lib/supabase-admin";
import { aparelhoConectado } from "@/lib/acesso-fornecedor";
import { dentroDoLimite, muitasTentativas, tokenValido } from "@/lib/links-api";
import { erroJson, mensagemDeErro } from "@/lib/auth-api";
import { STATUS, type StatusCorrida } from "@/lib/status";
import { formatarData, formatarHora } from "@/lib/datas";
import { formatarPlaca } from "@/lib/motorista";
import { buscarPaginado, periodoExportacao } from "@/lib/exportacao-fornecedor";

export const dynamic = "force-dynamic";

const LIMITE_LINHAS = 5000;

/** Corridas atribuídas ao fornecedor do portal, com data prevista dentro do intervalo pedido. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = q.get("token");
  if (!tokenValido(token)) return erroJson("Link inválido.", 404);
  if (!(await dentroDoLimite(`portal-exportar:${token}`, 20, 60))) return muitasTentativas();
  const periodo = periodoExportacao(q.get("de"), q.get("ate"));
  if ("erro" in periodo) return erroJson(periodo.erro, 400);
  try {
    const db = supabaseAdmin();
    const { data: forn, error } = await db.from("fornecedores").select("id,nome,ativo,token_portal,codigo_acesso").eq("token_portal", token).maybeSingle();
    if (error) throw new Error(error.message);
    if (!forn?.ativo) return erroJson("Este link não vale mais. Peça um novo ao planejamento.", 404);
    if (!aparelhoConectado(req, forn)) return Response.json({ erro: "Entre com seu e-mail e código de acesso.", login: true }, { status: 401 });
    const lista = await buscarPaginado<any>((de, ate) => db.from("corridas_lista")
      .select("id,protocolo,status,tipo,data_hora_prevista,origem,destino,qtd_passageiros,solicitante_nome,solicitante_setor,motorista,veiculo_placa,valor_informado,observacoes")
      .eq("fornecedor_id", forn.id)
      .gte("data_hora_prevista", periodo.inicio.toISOString()).lt("data_hora_prevista", periodo.fim.toISOString())
      .order("data_hora_prevista", { ascending: true }).order("id").range(de, ate), LIMITE_LINHAS + 1);
    return Response.json({
      fornecedor: forn.nome,
      truncado: lista.length > LIMITE_LINHAS,
      corridas: lista.slice(0, LIMITE_LINHAS).map((c: any) => ({
        protocolo: c.protocolo,
        data: formatarData(c.data_hora_prevista), hora: formatarHora(c.data_hora_prevista),
        tipo: c.tipo === "agendada" ? "Agendada" : "Imediata",
        status: STATUS[c.status as StatusCorrida]?.rotulo ?? c.status,
        solicitante: c.solicitante_nome, setor: c.solicitante_setor ?? null,
        origem: c.origem, destino: c.destino, passageiros: c.qtd_passageiros,
        motorista: c.motorista ?? null, placa: c.veiculo_placa ? formatarPlaca(c.veiculo_placa) : null,
        valor: c.valor_informado != null ? Number(c.valor_informado) : null,
        observacoes: c.observacoes ?? null,
      })),
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
