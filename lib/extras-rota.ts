/**
 * Roteirização de Extras: junta os colaboradores que fazem hora extra nos menos carros possíveis, nesta ordem de prioridade:
 *   1. menor custo (valor da Tabela de preços do fornecedor mais barato para cada carro);
 *   2. menor número de carros;
 *   3. menor km rodado.
 * Só funções puras: a API geocodifica os endereços, lê a tabela de preços e mede o km real das rotas finais.
 * Distâncias aqui são estimadas (linha reta × 1,3), o bastante para comparar agrupamentos.
 */
import { distanciaReta, type Ponto } from "./distancia";
import { ordenarDestinos } from "./multidestino";
import { escolherPrecoTrecho, normalizar, veiculoPorPassageiros, type LinhaPreco, type Onde, type Veiculo } from "./precos";

export type PessoaExtra = {
  id: string; nome: string; endereco: string; bairro: string | null; cidade: string | null; uf: string | null;
  /** Null quando o endereço não foi achado no mapa. */
  ponto: Ponto | null; onde: Onde;
};
export type TabelaFornecedor = { id: string; nome: string; linhas: LinhaPreco[] };
export type Sentido = "entrada" | "saida";

export type CarroPlano = {
  /** Na ordem do percurso: na saída, da unidade para fora; na entrada, o inverso (a última casa antes da unidade é a mais perto). */
  pessoas: PessoaExtra[];
  passageiros: number; paradas: number; veiculo: Veiculo;
  kmEstimado: number | null;
  valor: number | null; fornecedorId: string | null; fornecedorNome: string | null; descricaoPreco: string | null;
  /** Nenhum fornecedor tem preço para o trecho. */
  semPreco: boolean;
  /** Algum endereço não foi achado no mapa: o carro vai sozinho, sem km estimado. */
  semLocal: boolean;
};

/** Veículo máximo que o planejamento aceita usar. */
export const CAPACIDADE: Record<Veiculo, number> = { passeio: 4, spin: 6, van: 15 };
/**
 * Endereços diferentes por carro. O pedido comum aceita 5 destinos; a extra aceita mais porque leva muita gente por carro
 * (van). 10 é o que cabe no link do Google Maps do roteiro (origem, 9 pontos de passagem e destino).
 */
export const MAX_PARADAS_EXTRA = 10;
/** Até este número de paradas testa todas as ordens; acima, vizinho mais próximo + 2-opt (resultado muito perto do melhor). */
const PARADAS_EXATO = 6;
const FATOR_RUA = 1.3;
const SEM_PRECO = 1e6;

const km = (a: Ponto, b: Ponto) => distanciaReta(a, b) * FATOR_RUA;
/** Mesmo endereço (casa de familiares, mesma vila): conta como uma parada só. */
const chaveParada = (p: PessoaExtra) => normalizar([p.endereco, p.bairro, p.cidade].filter(Boolean).join(" "));

type Avaliado = {
  pessoas: PessoaExtra[]; ordem: PessoaExtra[]; paradas: number; kmEstimado: number | null;
  custo: number; valor: number | null; fornecedor: TabelaFornecedor | null; descricao: string | null; semLocal: boolean;
};
type Contexto = { unidade: Ponto; tabelas: TabelaFornecedor[]; capacidade: number; preco: (onde: Onde, n: number, varias: boolean) => ReturnType<typeof melhorPreco>; memo: Map<string, Avaliado | null> };

/** Menor valor da tabela entre os fornecedores para o trecho que vai até a casa mais longe. */
function melhorPreco(tabelas: TabelaFornecedor[], onde: Onde, passageiros: number, variasParadas: boolean) {
  let melhor: { valor: number; fornecedor: TabelaFornecedor; descricao: string } | null = null;
  for (const t of tabelas) {
    if (!t.linhas.length) continue;
    const p = escolherPrecoTrecho(t.linhas, [onde], passageiros, variasParadas);
    if (p && (!melhor || p.valor < melhor.valor - 1e-9)) melhor = { valor: p.valor, fornecedor: t, descricao: p.descricao };
  }
  return melhor;
}

/** Final = a casa mais longe da unidade; as outras pelo vizinho mais próximo, melhoradas com 2-opt (pontas fixas). */
function ordemAproximada(daOrigem: number[], entre: number[][]): { ordem: number[]; final: number; km: number } {
  const n = daOrigem.length;
  const final = daOrigem.reduce((m, v, i) => (v > daOrigem[m] ? i : m), 0);
  const d = (a: number, b: number) => (a === -1 ? daOrigem[b] : b === -1 ? daOrigem[a] : entre[a][b]);
  const pend = new Set([...Array(n).keys()].filter((i) => i !== final));
  const caminho = [-1];
  while (pend.size) {
    const atual = caminho[caminho.length - 1];
    let melhor = -2;
    for (const i of pend) if (melhor === -2 || d(atual, i) < d(atual, melhor)) melhor = i;
    pend.delete(melhor); caminho.push(melhor);
  }
  caminho.push(final);
  for (let melhorou = true; melhorou;) {
    melhorou = false;
    for (let i = 1; i < caminho.length - 2; i++) for (let j = i + 1; j < caminho.length - 1; j++) {
      const ganho = d(caminho[i - 1], caminho[i]) + d(caminho[j], caminho[j + 1]) - d(caminho[i - 1], caminho[j]) - d(caminho[i], caminho[j + 1]);
      if (ganho > 1e-9) { caminho.splice(i, j - i + 1, ...caminho.slice(i, j + 1).reverse()); melhorou = true; }
    }
  }
  const ordem = caminho.slice(1);
  return { ordem, final, km: caminho.slice(1).reduce((s, x, k) => s + d(caminho[k], x), 0) };
}

/** Ordem das casas na saída (da unidade para fora): a mais longe é a última; as outras na ordem de menor km. */
function ordenarSaida(unidade: Ponto, pessoas: PessoaExtra[]): { ordem: PessoaExtra[]; km: number } {
  const paradas: PessoaExtra[] = [];
  for (const p of pessoas) if (!paradas.some((x) => chaveParada(x) === chaveParada(p))) paradas.push(p);
  const daOrigem = paradas.map((p) => km(unidade, p.ponto!));
  const entre = paradas.map((a) => paradas.map((b) => (a === b ? 0 : km(a.ponto!, b.ponto!))));
  const o = paradas.length <= PARADAS_EXATO ? ordenarDestinos(daOrigem, entre) : ordemAproximada(daOrigem, entre);
  const ordemParadas = o.ordem.map((i) => paradas[i]);
  const ordem = ordemParadas.flatMap((x) => pessoas.filter((p) => chaveParada(p) === chaveParada(x)));
  return { ordem, km: o.km };
}

function avaliar(pessoas: PessoaExtra[], ctx: Contexto): Avaliado | null {
  const chave = pessoas.map((p) => p.id).sort().join("|");
  if (ctx.memo.has(chave)) return ctx.memo.get(chave)!;
  const r = avaliarSemCache(pessoas, ctx);
  ctx.memo.set(chave, r);
  return r;
}
function avaliarSemCache(pessoas: PessoaExtra[], ctx: Contexto): Avaliado | null {
  const paradas = new Set(pessoas.map(chaveParada)).size;
  if (pessoas.length > ctx.capacidade || paradas > MAX_PARADAS_EXTRA) return null;
  if (pessoas.some((p) => !p.ponto)) {
    // Sem localização não dá para juntar: só vale sozinho
    if (pessoas.length > 1) return null;
    return { pessoas, ordem: pessoas, paradas: 1, kmEstimado: null, custo: SEM_PRECO, valor: null, fornecedor: null, descricao: null, semLocal: true };
  }
  const { ordem, km: kmRota } = ordenarSaida(ctx.unidade, pessoas);
  const maisLonge = ordem[ordem.length - 1];
  const p = ctx.preco(maisLonge.onde, pessoas.length, paradas > 1);
  return {
    pessoas, ordem, paradas, kmEstimado: Math.round(kmRota * 100) / 100,
    custo: p ? p.valor : SEM_PRECO, valor: p?.valor ?? null, fornecedor: p?.fornecedor ?? null, descricao: p?.descricao ?? null, semLocal: false,
  };
}

const igual = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** Compara (custo, carros, km): negativo quando `a` é melhor que `b`. */
const melhorQue = (a: { custo: number; carros: number; km: number }, b: { custo: number; carros: number; km: number }) =>
  !igual(a.custo, b.custo) ? a.custo - b.custo : a.carros !== b.carros ? a.carros - b.carros : a.km - b.km;

const soma = (gs: Avaliado[]) => ({ custo: gs.reduce((s, g) => s + g.custo, 0), carros: gs.length, km: gs.reduce((s, g) => s + (g.kmEstimado ?? 0), 0) });
const centro = (g: Avaliado): Ponto | null => {
  const ps = g.pessoas.map((p) => p.ponto).filter((p): p is Ponto => !!p);
  return ps.length ? { lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.lng, 0) / ps.length } : null;
};
/** Índices dos `k` grupos mais perto de `i` (pelo centro), sem os que não têm localização. */
function vizinhos(centros: (Ponto | null)[], i: number, k: number): number[] {
  const c = centros[i];
  if (!c) return [];
  return centros.map((x, j) => ({ j, d: x && j !== i ? distanciaReta(c, x) : Infinity })).filter((x) => x.d < Infinity)
    .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.j);
}

/** Quantos grupos vizinhos cada grupo ou pessoa testa: mantém o trabalho linear em vez de quadrático com centenas de pessoas. */
const VIZINHOS = 8;

export function planejarExtras(op: { pessoas: PessoaExtra[]; unidade: Ponto; tabelas: TabelaFornecedor[]; veiculoMaximo: Veiculo; sentido: Sentido }): CarroPlano[] {
  const precos = new Map<string, ReturnType<typeof melhorPreco>>();
  const ctx: Contexto = {
    unidade: op.unidade, tabelas: op.tabelas, capacidade: CAPACIDADE[op.veiculoMaximo], memo: new Map(),
    preco: (onde, n, varias) => {
      const chave = `${onde.cidade}|${(onde.bairros ?? []).join(",")}|${onde.texto}|${n}|${varias}`;
      if (!precos.has(chave)) precos.set(chave, melhorPreco(op.tabelas, onde, n, varias));
      return precos.get(chave)!;
    },
  };
  let grupos: Avaliado[] = op.pessoas.map((p) => avaliar([p], ctx)!);

  // 1) Junta carros enquanto o custo não sobe (cada junção tira um carro). Em cada rodada cada grupo olha só os vizinhos mais perto;
  //    as junções vão da mais barata (depois a de menos km a mais) e nenhum grupo entra em duas junções na mesma rodada.
  for (let rodada = 0; rodada < 60; rodada++) {
    const centros = grupos.map(centro);
    const vistos = new Set<string>();
    const candidatas: { i: number; j: number; novo: Avaliado; dCusto: number; dKm: number }[] = [];
    for (let i = 0; i < grupos.length; i++) {
      for (const j of vizinhos(centros, i, VIZINHOS)) {
        const chave = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const a = grupos[i], b = grupos[j];
        const novo = avaliar([...a.pessoas, ...b.pessoas], ctx);
        // Sem preço para o carro junto: não inventa; cada um segue no seu
        if (!novo || novo.custo >= SEM_PRECO) continue;
        const dCusto = novo.custo - (a.custo + b.custo);
        const dKm = (novo.kmEstimado ?? 0) - ((a.kmEstimado ?? 0) + (b.kmEstimado ?? 0));
        if (dCusto > 0.005) continue;
        // Mesmo custo: só junta se o carro único não roda mais que os dois separados
        if (igual(dCusto, 0) && dKm > 0) continue;
        candidatas.push({ i, j, novo, dCusto, dKm });
      }
    }
    if (!candidatas.length) break;
    candidatas.sort((x, y) => (igual(x.dCusto, y.dCusto) ? x.dKm - y.dKm : x.dCusto - y.dCusto));
    const usados = new Set<number>();
    const novos: Avaliado[] = [];
    for (const c of candidatas) {
      if (usados.has(c.i) || usados.has(c.j)) continue;
      usados.add(c.i); usados.add(c.j); novos.push(c.novo);
    }
    grupos = grupos.filter((_, k) => !usados.has(k)).concat(novos);
  }

  // 2) Melhoria local: muda uma pessoa para um carro vizinho quando o total dos dois carros melhora (custo, carros, km)
  for (let passada = 0; passada < 6; passada++) {
    let mudou = false;
    for (let i = 0; i < grupos.length; i++) {
      const gi = grupos[i];
      if (!gi || gi.semLocal) continue;
      for (const p of gi.pessoas) {
        const centros = grupos.map(centro);
        const alvo = p.ponto!;
        const perto = centros.map((c, j) => ({ j, d: c && j !== i && !grupos[j].semLocal ? distanciaReta(alvo, c) : Infinity })).filter((x) => x.d < Infinity)
          .sort((a, b) => a.d - b.d).slice(0, VIZINHOS);
        let feito = false;
        for (const { j } of perto) {
          const gj = grupos[j];
          const sem = gi.pessoas.filter((x) => x !== p);
          const origem = sem.length ? avaliar(sem, ctx) : null;
          const destino = avaliar([...gj.pessoas, p], ctx);
          if (!destino || destino.custo >= SEM_PRECO || (sem.length && (!origem || origem.custo >= SEM_PRECO))) continue;
          const antes = soma([gi, gj]), depois = soma([destino, ...(origem ? [origem] : [])]);
          if (melhorQue(depois, antes) < -1e-9) {
            grupos = grupos.filter((_, k) => k !== i && k !== j).concat(destino, ...(origem ? [origem] : []));
            mudou = true; feito = true; break;
          }
        }
        if (feito) break;
      }
      if (mudou) break;
    }
    if (!mudou) break;
  }

  const carros = grupos.map((g): CarroPlano => ({
    pessoas: op.sentido === "entrada" ? [...g.ordem].reverse() : g.ordem,
    passageiros: g.pessoas.length, paradas: g.paradas, veiculo: veiculoPorPassageiros(g.pessoas.length),
    kmEstimado: g.kmEstimado, valor: g.valor, fornecedorId: g.fornecedor?.id ?? null, fornecedorNome: g.fornecedor?.nome ?? null,
    descricaoPreco: g.descricao, semPreco: g.valor == null, semLocal: g.semLocal,
  }));
  // Ordem estável de leitura: o carro que vai mais longe primeiro
  return carros.sort((a, b) => (b.kmEstimado ?? Infinity) - (a.kmEstimado ?? Infinity) || a.pessoas[0].nome.localeCompare(b.pessoas[0].nome, "pt-BR"));
}

/** Pontos do percurso do carro, na ordem em que o carro passa: unidade → casas (saída) ou casas → unidade (entrada). */
export function percurso(carro: CarroPlano, unidade: Ponto, sentido: Sentido): Ponto[] {
  return percursoDeCasas(carro.pessoas.map((p) => p.ponto!).filter(Boolean), unidade, sentido);
}
/** Mesmo percurso a partir das casas, já na ordem do carro. */
export function percursoDeCasas(casas: Ponto[], unidade: Ponto, sentido: Sentido): Ponto[] {
  const seq = sentido === "entrada" ? [...casas, unidade] : [unidade, ...casas];
  // Pessoas no mesmo endereço não viram parada nova
  return seq.filter((p, i) => i === 0 || p.lat !== seq[i - 1].lat || p.lng !== seq[i - 1].lng);
}

export type Resumo = { carros: number; passageiros: number; km: number; valor: number; semPreco: number };
export function resumir(carros: CarroPlano[], kmReal?: (number | null)[]): Resumo {
  return {
    carros: carros.length, passageiros: carros.reduce((s, c) => s + c.passageiros, 0),
    km: Math.round(carros.reduce((s, c, i) => s + (kmReal?.[i] ?? c.kmEstimado ?? 0), 0) * 10) / 10,
    valor: Math.round(carros.reduce((s, c) => s + (c.valor ?? 0), 0) * 100) / 100, semPreco: carros.filter((c) => c.semPreco).length,
  };
}
