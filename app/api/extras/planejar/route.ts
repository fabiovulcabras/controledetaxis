import { supabaseAdmin } from "@/lib/supabase-admin";
import { erroJson, mensagemDeErro, usuarioDaRequisicao } from "@/lib/auth-api";
import { coordenadasDoTexto } from "@/lib/km-corrida";
import { CAPACIDADE, planejarExtras, resumir, type Sentido, type TabelaFornecedor } from "@/lib/extras-rota";
import { emParalelo, kmRealDoCarro, localizarCasa, paraPessoa, textoEndereco, type ColaboradorDb, type Precisao } from "@/lib/extras-servidor";
import type { LinhaPreco, Veiculo } from "@/lib/precos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_COLABORADORES = 40;
const ROTULO_PRECISAO: Record<Precisao, string> = { endereco: "endereço", bairro: "só o bairro", cidade: "só a cidade", nenhuma: "não localizado" };

/**
 * Plano de uma extra: localiza a casa de cada colaborador (cidade, estado e bairro vêm do cadastro), agrupa nos menos carros
 * (custo, depois carros, depois km) e mede o km real de cada carro. Não grava nada: a corrida só nasce em /api/extras/gerar.
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
    const [{ data: colabs, error: e1 }, { data: unidade, error: e2 }] = await Promise.all([
      db.from("colaboradores").select("id,codigo,nome,endereco,bairro,cidade,uf,cep,ativo").in("id", ids),
      db.from("unidades").select("id,nome,endereco_padrao,lat,lng").eq("id", String(corpo?.unidade_id ?? "")).eq("ativo", true).maybeSingle(),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!unidade) return erroJson("Escolha a unidade da empresa.");
    const achados = (colabs ?? []) as (ColaboradorDb & { ativo: boolean })[];
    const inativos = achados.filter((c) => !c.ativo).map((c) => c.nome);
    if (achados.length !== ids.length) return erroJson("Algum colaborador não foi encontrado no cadastro. Atualize a página.");
    if (inativos.length) return erroJson(`Colaborador desligado: ${inativos.join(", ")}.`);

    const textoUnidade = String(unidade.endereco_padrao ?? "").trim() || unidade.nome;
    const pontoUnidade = unidade.lat != null && unidade.lng != null ? { lat: Number(unidade.lat), lng: Number(unidade.lng) } : await coordenadasDoTexto(textoUnidade);
    if (!pontoUnidade) return erroJson(`Não achei "${textoUnidade}" no mapa. Confira o endereço da unidade em Cadastros › Unidades.`);

    const localizados = await emParalelo(achados, 4, (c) => localizarCasa(c));
    const [{ data: forns, error: e3 }, { data: linhas, error: e4 }] = await Promise.all([
      db.from("fornecedores").select("id,nome").eq("ativo", true),
      db.from("precos_tabela").select("*").eq("ativo", true),
    ]);
    if (e3 || e4) throw new Error((e3 ?? e4)!.message);
    const tabelas: TabelaFornecedor[] = (forns ?? []).map((f: any) => ({ id: f.id, nome: f.nome, linhas: ((linhas ?? []) as LinhaPreco[]).filter((l) => l.fornecedor_id === f.id) }));

    const pessoas = achados.map((c, i) => paraPessoa(c, localizados[i].ponto));
    const carros = planejarExtras({ pessoas, unidade: pontoUnidade, tabelas, veiculoMaximo, sentido });
    const reais = await emParalelo(carros, 3, (c) => kmRealDoCarro(db, c, pontoUnidade, sentido));

    const precisao = new Map(achados.map((c, i) => [c.id, localizados[i].precisao]));
    const avisos: string[] = [];
    for (const c of achados) {
      const p = precisao.get(c.id)!;
      if (!c.cidade) avisos.push(`${c.nome}: sem cidade no cadastro. Importe a planilha de Ativos com endereço e cidade.`);
      else if (p === "nenhuma") avisos.push(`${c.nome}: endereço não localizado no mapa; vai em carro separado, sem km.`);
      else if (p !== "endereco") avisos.push(`${c.nome}: localizado só pelo ${p === "bairro" ? "bairro" : "centro da cidade"}; o km é aproximado.`);
    }
    if (!tabelas.some((t) => t.linhas.length)) avisos.push("Nenhum fornecedor tem Tabela de preços cadastrada: o custo não pôde ser calculado.");
    carros.forEach((c) => { if (c.semPreco && !c.semLocal) avisos.push(`Sem preço na tabela para ${c.pessoas[c.pessoas.length - 1].cidade ?? "esta cidade"} (${c.pessoas.map((p) => p.nome).join(", ")}).`); });

    return Response.json({
      unidade: { id: unidade.id, nome: unidade.nome, endereco: textoUnidade },
      sentido,
      carros: carros.map((c, i) => ({
        passageiros: c.passageiros, paradas: c.paradas, veiculo: c.veiculo,
        km: reais[i]?.km ?? c.kmEstimado, km_estimado: reais[i] ? reais[i]!.estimado : true,
        valor: c.valor, fornecedor: c.fornecedorNome, descricao_preco: c.descricaoPreco, sem_preco: c.semPreco, sem_local: c.semLocal,
        pessoas: c.pessoas.map((p) => {
          const c0 = achados.find((x) => x.id === p.id)!;
          return { id: p.id, nome: p.nome, endereco: textoEndereco(c0), bairro: p.bairro, cidade: p.cidade, uf: p.uf, localizacao: ROTULO_PRECISAO[precisao.get(p.id)!] };
        }),
      })),
      resumo: resumir(carros, reais.map((r) => r?.km ?? null)),
      avisos,
    });
  } catch (err) {
    return erroJson(mensagemDeErro(err), 500);
  }
}
