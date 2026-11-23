import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { despacharOuSegurar, escolherFornecedor } from "@/lib/bot/acoes";
import { despacharSaidas, envioAutomatico } from "@/lib/whatsapp/transporte";
import { linkWhatsApp, msgNovaCorridaFornecedor, urlApp } from "@/lib/whatsapp/link";
import { repoServidor } from "@/lib/links-api";
import { MAX_PARADAS_EXTRA } from "@/lib/extras-rota";
import { textoEndereco, type ColaboradorDb } from "@/lib/extras-servidor";
import { normalizar } from "@/lib/precos";
import { formatarDataHora } from "@/lib/datas";
import type { Saida } from "@/lib/bot/tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Cada corrida consulta o mapa para o preço da tabela; poucas por chamada para caber nos 60 s. O painel chama em lotes. */
const CARROS_POR_CHAMADA = 8;

/**
 * Cria uma corrida por carro do plano, na ordem dos colaboradores, e envia cada uma ao fornecedor mais barato do trecho
 * (mesmo fluxo de um pedido: aprovação do planejamento quando exigida, prazo de resposta, WhatsApp).
 * O servidor monta os endereços a partir do cadastro; do painel só vêm os ids, na ordem do carro.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const sentido = corpo?.sentido === "entrada" ? "entrada" : "saida";
  const lote = typeof corpo?.lote === "string" && /^[\w-]{8,60}$/.test(corpo.lote) ? corpo.lote : null;
  const carros: string[][] = Array.isArray(corpo?.carros) ? corpo.carros.map((c: unknown) => (Array.isArray(c) ? c.map(String) : [])) : [];
  const inicio = Number.isInteger(corpo?.inicio) && corpo.inicio >= 0 ? corpo.inicio : 0;
  const totalCarros = Number.isInteger(corpo?.total) && corpo.total >= carros.length ? corpo.total : carros.length;
  const quando = new Date(corpo?.data_hora);
  const agora = new Date();
  if (!lote) return erroJson("Pedido inválido. Atualize a página e tente de novo.");
  if (isNaN(quando.getTime()) || quando.getTime() < agora.getTime() - 2 * 60_000) return erroJson("Informe a data e hora da extra, no futuro.");
  if (!carros.length || carros.some((c) => !c.length)) return erroJson("O plano não tem carros.");
  if (carros.length > CARROS_POR_CHAMADA) return erroJson(`Envie no máximo ${CARROS_POR_CHAMADA} carros por vez.`);
  const todos = carros.flat();
  if (new Set(todos).size !== todos.length || todos.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) return erroJson("Colaborador repetido ou inválido no plano.");
  try {
    const db = supabaseAdmin();
    const repo = repoServidor();
    const [{ data: sol }, { data: unidade }, { data: colabs }] = await Promise.all([
      db.from("solicitantes").select("id,nome,fornecedor_padrao_id,ativo").eq("id", String(corpo?.solicitante_id ?? "")).maybeSingle(),
      db.from("unidades").select("id,nome,endereco_padrao").eq("id", String(corpo?.unidade_id ?? "")).eq("ativo", true).maybeSingle(),
      db.from("colaboradores").select("id,codigo,nome,endereco,bairro,cidade,uf,cep,ativo").in("id", todos),
    ]);
    if (!sol?.ativo) return erroJson("Escolha a pessoa autorizada que responde por esta extra.");
    if (!unidade) return erroJson("Escolha a unidade da empresa.");
    const porId = new Map(((colabs ?? []) as (ColaboradorDb & { ativo: boolean })[]).map((c) => [c.id, c]));
    if (todos.some((i) => !porId.get(i)?.ativo)) return erroJson("Algum colaborador do plano não está ativo no cadastro.");
    const textoUnidade = `${unidade.nome}${unidade.endereco_padrao ? ` – ${unidade.endereco_padrao}` : ""}`;
    const dataTxt = formatarDataHora(quando.toISOString());

    const saidas: Saida[] = [];
    const resultado: { protocolo: string; fornecedor: string | null; passageiros: number; aviso?: string; whatsapp?: string }[] = [];
    for (const [indice, ids] of carros.entries()) {
      const numero = inicio + indice;
      const chave = `extra-${lote}-${numero}`;
      const { data: existente } = await db.from("corridas").select("protocolo,qtd_passageiros,fornecedor_id").eq("chave_envio", chave).maybeSingle();
      if (existente) { resultado.push({ protocolo: existente.protocolo, fornecedor: null, passageiros: existente.qtd_passageiros, aviso: "Já tinha sido criada." }); continue; }

      const pessoas = ids.map((i) => porId.get(i)!);
      const casas = pessoas.map((p) => ({ texto: textoEndereco(p), chave: normalizar(textoEndereco(p)) }))
        .filter((c, i, l) => l.findIndex((x) => x.chave === c.chave) === i); // mesma casa: uma parada só
      if (casas.length > MAX_PARADAS_EXTRA) return erroJson(`Um carro não pode ter mais de ${MAX_PARADAS_EXTRA} endereços diferentes.`);
      // Saída: da unidade até a casa mais longe (a última). Entrada: da casa mais longe (a primeira) até a unidade.
      const origem = sentido === "saida" ? textoUnidade : casas[0].texto;
      const destino = sentido === "saida" ? casas[casas.length - 1].texto : textoUnidade;
      const meio = sentido === "saida" ? casas.slice(0, -1) : casas.slice(1);
      const paradas = meio.map((c) => ({ texto: c.texto, lat: null, lng: null }));
      const nomes = pessoas.map((p) => p.nome);
      const observacoes = `Extra ${sentido === "saida" ? "(saída da empresa)" : "(entrada na empresa)"} ${dataTxt}, carro ${numero + 1} de ${totalCarros}: ${pessoas.map((p) => `${p.nome} (${p.bairro ?? p.cidade ?? "-"})`).join("; ")}`.slice(0, 900);

      const corrida = await repo.criarCorrida({
        solicitante_id: sol.id, tipo: quando.getTime() - agora.getTime() > 5 * 60_000 ? "agendada" : "imediata", data_hora_prevista: quando.toISOString(),
        origem, destino, ...(paradas.length ? { paradas } : {}), qtd_passageiros: pessoas.length,
        outros_passageiros: pessoas.length > 1 ? nomes.join("; ").slice(0, 900) : null, motivo: "Hora extra", observacoes, chave_envio: chave,
      });
      const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id, corrida);
      if (!forn) { resultado.push({ protocolo: corrida.protocolo, fornecedor: null, passageiros: pessoas.length, aviso: "Sem fornecedor que atenda o trecho: trate em Corridas." }); continue; }
      const r = await despacharOuSegurar(repo, corrida, forn, agora, "planejamento", `Extra gerada por ${usuario.nome}; enviada a ${forn.nome}`);
      saidas.push(...r.saidas);
      resultado.push({
        protocolo: r.corrida.protocolo, fornecedor: r.aprovacao ? null : forn.nome, passageiros: pessoas.length,
        ...(r.aprovacao ? { aviso: `Aguardando aprovação do planejamento (${r.aprovacao}).` } : {}),
        ...(!r.aprovacao && !envioAutomatico() ? { whatsapp: linkWhatsApp(forn.telefone_whatsapp, msgNovaCorridaFornecedor(r.corrida, sol.nome, urlApp(req))) } : {}),
      });
    }
    await despacharSaidas(db, saidas);
    return Response.json({ corridas: resultado, envio_automatico: envioAutomatico() });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
