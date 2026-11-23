import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { CAPACIDADE, planejarExtras, resumir, type Sentido, type TabelaFornecedor } from "@/lib/extras-rota";
import { lerColaboradores, paraPessoa, pontoDaUnidade, pontoGuardado, textoEndereco, type Precisao } from "@/lib/extras-servidor";
import type { LinhaPreco, Veiculo } from "@/lib/precos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_COLABORADORES = 1000;
const ROTULO_PRECISAO: Record<Precisao, string> = { endereco: "endereço", bairro: "só o bairro", cidade: "só a cidade", nenhuma: "não localizado" };

/**
 * Plano de uma extra. Usa as coordenadas já guardadas em /api/extras/localizar (nenhuma busca no mapa aqui, então é rápido
 * mesmo com centenas de pessoas): agrupa nos menos carros (custo, depois carros, depois km estimado em linha reta).
 * O km real vem depois, por /api/extras/km. Não grava nada: a corrida só nasce em /api/extras/gerar.
 */
export async function POST(req: Request) {
  const usuario = await usuarioDaRequisicao(req, ["admin", "planejamento"]);
  if (usuario instanceof Response) return usuario;
  const corpo = await req.json().catch(() => null);
  const ids = [...new Set((Array.isArray(corpo?.colaboradores) ? corpo.colaboradores : []).map(String))] as string[];
  const sentido: Sentido = corpo?.sentido === "entrada" ? "entrada" : "saida";
  const veiculoMaximo = (corpo?.veiculo_maximo in CAPACIDADE ? corpo.veiculo_maximo : "spin") as Veiculo;
  if (!ids.length) return erroJson("Adicione pelo menos um colaborador.");
  if (ids.length > MAX_COLABORADORES) return erroJson(`No máximo ${MAX_COLABORADORES} colaboradores por extra.`);
  if (ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) return erroJson("Colaborador inválido.");
  try {
    const db = supabaseAdmin();
    const [achados, { data: unidade, error: e2 }] = await Promise.all([
      lerColaboradores(db, ids),
      db.from("unidades").select("id,nome,endereco_padrao,lat,lng").eq("id", String(corpo?.unidade_id ?? "")).eq("ativo", true).maybeSingle(),
    ]);
    if (e2) throw new Error(e2.message);
    if (!unidade) return erroJson("Escolha a unidade da empresa.");
    if (achados.length !== ids.length) return erroJson("Algum colaborador não foi encontrado no cadastro. Atualize a página.");
    const inativos = achados.filter((c) => !c.ativo).map((c) => c.nome);
    if (inativos.length) return erroJson(`Colaborador desligado: ${inativos.slice(0, 5).join(", ")}${inativos.length > 5 ? ` e mais ${inativos.length - 5}` : ""}.`);

    const { ponto: pontoUnidade, texto: textoUnidade } = await pontoDaUnidade(unidade);
    if (!pontoUnidade) return erroJson(`Não achei "${textoUnidade}" no mapa. Confira o endereço da unidade em Cadastros › Unidades.`);

    const [{ data: forns, error: e3 }, { data: linhas, error: e4 }] = await Promise.all([
      db.from("fornecedores").select("id,nome").eq("ativo", true),
      db.from("precos_tabela").select("*").eq("ativo", true).limit(20000),
    ]);
    if (e3 || e4) throw new Error((e3 ?? e4)!.message);
    const tabelas: TabelaFornecedor[] = (forns ?? []).map((f: any) => ({ id: f.id, nome: f.nome, linhas: ((linhas ?? []) as LinhaPreco[]).filter((l) => l.fornecedor_id === f.id) }));

    const pessoas = achados.map((c) => paraPessoa(c, pontoGuardado(c)));
    const carros = planejarExtras({ pessoas, unidade: pontoUnidade, tabelas, veiculoMaximo, sentido });

    const porId = new Map(achados.map((c) => [c.id, c]));
    const semCidade = achados.filter((c) => !c.cidade);
    const naoLocalizados = achados.filter((c) => c.cidade && !pontoGuardado(c));
    const aproximados = achados.filter((c) => c.cidade && pontoGuardado(c) && c.geo_precisao && c.geo_precisao !== "endereco");
    const lista = (l: { nome: string }[]) => l.slice(0, 5).map((c) => c.nome).join(", ") + (l.length > 5 ? ` e mais ${l.length - 5}` : "");
    const avisos: string[] = [];
    if (semCidade.length) avisos.push(`${semCidade.length} colaborador(es) sem cidade no cadastro (${lista(semCidade)}): importe a planilha de Ativos com endereço e cidade.`);
    if (naoLocalizados.length) avisos.push(`${naoLocalizados.length} endereço(s) não localizado(s) no mapa (${lista(naoLocalizados)}): cada um vai em carro separado, sem km.`);
    if (aproximados.length) avisos.push(`${aproximados.length} localizado(s) só pelo bairro ou pela cidade (${lista(aproximados)}): o km é aproximado.`);
    if (!tabelas.some((t) => t.linhas.length)) avisos.push("Nenhum fornecedor tem Tabela de preços cadastrada: o custo não pôde ser calculado.");
    const semPreco = carros.filter((c) => c.semPreco && !c.semLocal);
    if (semPreco.length) {
      const cidades = [...new Set(semPreco.map((c) => c.pessoas[c.pessoas.length - 1].cidade ?? "?"))];
      avisos.push(`${semPreco.reduce((s, c) => s + c.passageiros, 0)} colaborador(es) em carros sem preço na Tabela de preços (${cidades.join(", ")}): confira a tabela.`);
    }

    return Response.json({
      unidade: { id: unidade.id, nome: unidade.nome, endereco: textoUnidade },
      sentido,
      carros: carros.map((c) => ({
        passageiros: c.passageiros, paradas: c.paradas, veiculo: c.veiculo,
        km: c.kmEstimado, km_estimado: true, km_est: c.kmEstimado,
        valor: c.valor, fornecedor: c.fornecedorNome, descricao_preco: c.descricaoPreco, sem_preco: c.semPreco, sem_local: c.semLocal, preco_por: c.precoPor,
        cidades: [...new Set(c.pessoas.map((p) => p.cidade).filter(Boolean))],
        pessoas: c.pessoas.map((p) => {
          const c0 = porId.get(p.id)!;
          return { id: p.id, nome: p.nome, endereco: textoEndereco(c0), bairro: p.bairro, cidade: p.cidade, uf: p.uf, localizacao: ROTULO_PRECISAO[(pontoGuardado(c0) ? c0.geo_precisao : null) ?? "nenhuma"] };
        }),
      })),
      resumo: resumir(carros),
      avisos,
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
