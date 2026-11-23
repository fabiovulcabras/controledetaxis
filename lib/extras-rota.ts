/**
 * Roteirização de Extras: junta os colaboradores que fazem hora extra nos menos carros possíveis, nesta ordem de prioridade:
 *   1. menor custo (valor da Tabela de preços do fornecedor mais barato para cada carro);
 *   2. menor número de carros;
 *   3. menor km rodado.
 * Só funções puras: a API geocodifica os endereços, lê a tabela de preços e mede o km real das rotas finais.
 * Distâncias aqui são estimadas (linha reta × 1,3), o bastante para comparar agrupamentos.
 */
import { distanciaReta, type Ponto } from "./distancia";
import { MAX_DESTINOS, ordenarDestinos } from "./multidestino";
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
const FATOR_RUA = 1.3;
const SEM_PRECO = 1e6;

const km = (a: Ponto, b: Ponto) => distanciaReta(a, b) * FATOR_RUA;
/** Mesmo endereço (casa de familiares, mesma vila): conta como uma parada só. */
const chaveParada = (p: PessoaExtra) => normalizar([p.endereco, p.bairro, p.cidade].filter(Boolean).join(" "));

type Avaliado = {
  pessoas: PessoaExtra[]; ordem: PessoaExtra[]; paradas: number; kmEstimado: number | null;
  custo: number; valor: number | null; fornecedor: TabelaFornecedor | null; descricao: string | null; semLocal: boolean;
};

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

/** Ordem das casas na saída (da unidade para fora): a mais longe é a última; as outras na ordem de menor km. */
function ordenarSaida(unidade: Ponto, pessoas: PessoaExtra[]): { ordem: PessoaExtra[]; km: number } {
  const paradas: PessoaExtra[] = [];
  for (const p of pessoas) if (!paradas.some((x) => chaveParada(x) === chaveParada(p))) paradas.push(p);
  const daOrigem = paradas.map((p) => km(unidade, p.ponto!));
  const entre = paradas.map((a) => paradas.map((b) => (a === b ? 0 : km(a.ponto!, b.ponto!))));
  const o = ordenarDestinos(daOrigem, entre);
  const ordemParadas = o.ordem.map((i) => paradas[i]);
  const ordem = ordemParadas.flatMap((x) => pessoas.filter((p) => chaveParada(p) === chaveParada(x)));
  return { ordem, km: o.km };
}

function avaliar(pessoas: PessoaExtra[], unidade: Ponto, tabelas: TabelaFornecedor[], capacidade: number): Avaliado | null {
  const paradas = new Set(pessoas.map(chaveParada)).size;
  if (pessoas.length > capacidade || paradas > MAX_DESTINOS) return null;
  if (pessoas.some((p) => !p.ponto)) {
    // Sem localização não dá para juntar: só vale sozinho
    if (pessoas.length > 1) return null;
    return { pessoas, ordem: pessoas, paradas: 1, kmEstimado: null, custo: SEM_PRECO, valor: null, fornecedor: null, descricao: null, semLocal: true };
  }
  const { ordem, km: kmRota } = ordenarSaida(unidade, pessoas);
  const maisLonge = ordem[ordem.length - 1];
  const p = melhorPreco(tabelas, maisLonge.onde, pessoas.length, paradas > 1);
  return {
    pessoas, ordem, paradas, kmEstimado: Math.round(kmRota * 100) / 100,
    custo: p ? p.valor : SEM_PRECO, valor: p?.valor ?? null, fornecedor: p?.fornecedor ?? null, descricao: p?.descricao ?? null, semLocal: false,
  };
}

const igual = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** Compara (custo, carros, km): negativo quando `a` é melhor que `b`. */
const melhorQue = (a: { custo: number; carros: number; km: number }, b: { custo: number; carros: number; km: number }) =>
  !igual(a.custo, b.custo) ? a.custo - b.custo : a.carros !== b.carros ? a.carros - b.carros : a.km - b.km;

const totais = (gs: Avaliado[]) => ({ custo: gs.reduce((s, g) => s + g.custo, 0), carros: gs.length, km: gs.reduce((s, g) => s + (g.kmEstimado ?? 0), 0) });

export function planejarExtras(op: { pessoas: PessoaExtra[]; unidade: Ponto; tabelas: TabelaFornecedor[]; veiculoMaximo: Veiculo; sentido: Sentido }): CarroPlano[] {
  const capacidade = CAPACIDADE[op.veiculoMaximo];
  const av = (ps: PessoaExtra[]) => avaliar(ps, op.unidade, op.tabelas, capacidade);
  let grupos: Avaliado[] = op.pessoas.map((p) => av([p])!);

  // 1) Junta carros enquanto o custo não sobe (cada junção tira um carro). Entre as junções, a mais barata, depois a de menos km a mais.
  for (;;) {
    let melhor: { i: number; j: number; novo: Avaliado; dCusto: number; dKm: number } | null = null;
    for (let i = 0; i < grupos.length; i++) for (let j = i + 1; j < grupos.length; j++) {
      const a = grupos[i], b = grupos[j];
      if (a.semLocal || b.semLocal) continue;
      const novo = av([...a.pessoas, ...b.pessoas]);
      if (!novo) continue;
      // Sem preço para o carro junto: não inventa; cada um segue no seu
      if (novo.custo >= SEM_PRECO) continue;
      const dCusto = novo.custo - (a.custo + b.custo);
      const dKm = (novo.kmEstimado ?? 0) - ((a.kmEstimado ?? 0) + (b.kmEstimado ?? 0));
      if (dCusto > 0.005) continue;
      // Mesmo custo: só junta se o carro único não roda mais que os dois separados
      if (igual(dCusto, 0) && dKm > 0) continue;
      if (!melhor || dCusto < melhor.dCusto - 0.005 || (igual(dCusto, melhor.dCusto) && dKm < melhor.dKm)) melhor = { i, j, novo, dCusto, dKm };
    }
    if (!melhor) break;
    grupos = grupos.filter((_, k) => k !== melhor!.i && k !== melhor!.j).concat(melhor.novo);
  }

  // 2) Melhoria local: muda uma pessoa de carro quando o total melhora (custo, carros, km)
  for (let volta = 0; volta < 6; volta++) {
    let mudou = false;
    for (let i = 0; i < grupos.length && !mudou; i++) {
      for (const p of grupos[i].pessoas) {
        if (grupos[i].semLocal) break;
        for (let j = 0; j < grupos.length && !mudou; j++) {
          if (j === i || grupos[j].semLocal) continue;
          const sem = grupos[i].pessoas.filter((x) => x !== p);
          const origem = sem.length ? av(sem) : null;
          const destino = av([...grupos[j].pessoas, p]);
          if (!destino || (sem.length && !origem) || destino.custo >= SEM_PRECO) continue;
          const depois = grupos.filter((_, k) => k !== i && k !== j).concat(destino, ...(origem ? [origem] : []));
          if (melhorQue(totais(depois), totais(grupos)) < -1e-9) { grupos = depois; mudou = true; break; }
        }
        if (mudou) break;
      }
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
  const casas = carro.pessoas.map((p) => p.ponto!).filter(Boolean);
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
