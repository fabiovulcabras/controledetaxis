import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ponto } from "./distancia";
import { coordenadasDoTexto, rotaComCache } from "./km-corrida";
import { percurso, type CarroPlano, type PessoaExtra, type Sentido } from "./extras-rota";

/** Colaborador como vem do banco (tabela colaboradores). */
export type ColaboradorDb = {
  id: string; codigo: string; nome: string; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
};
export type Precisao = "endereco" | "bairro" | "cidade" | "nenhuma";

const cepBonito = (cep: string | null) => (cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null);
const cidadeUf = (c: Pick<ColaboradorDb, "cidade" | "uf">) => [c.cidade, c.uf].filter(Boolean).join(" - ");

/** Endereço de casa em uma linha, do jeito que vai na corrida e na busca do mapa. */
export function textoEndereco(c: ColaboradorDb): string {
  return [c.endereco, c.bairro, cidadeUf(c), cepBonito(c.cep)].filter(Boolean).join(", ");
}

/**
 * Acha a casa no mapa, da busca mais exata para a mais aberta: endereço completo, depois bairro e cidade, depois só a cidade.
 * `precisao` diz até onde deu para chegar (cidade e bairro valem para o preço; o km fica menos exato).
 */
export async function localizarCasa(c: ColaboradorDb): Promise<{ ponto: Ponto | null; precisao: Precisao }> {
  const tentativas: [string, Precisao][] = [
    [textoEndereco(c) + ", Brasil", "endereco"],
    [[c.bairro, cidadeUf(c)].filter(Boolean).join(", ") + ", Brasil", "bairro"],
    [cidadeUf(c) + ", Brasil", "cidade"],
  ];
  const vistos = new Set<string>();
  for (const [texto, precisao] of tentativas) {
    if (!c.cidade || vistos.has(texto)) continue;
    if (precisao === "endereco" && !c.endereco) continue;
    if (precisao === "bairro" && !c.bairro) continue;
    vistos.add(texto);
    const g = await coordenadasDoTexto(texto);
    if (g) return { ponto: { lat: g.lat, lng: g.lng }, precisao };
  }
  return { ponto: null, precisao: "nenhuma" };
}

/** Roda `fn` em todos os itens, `n` por vez (o serviço de mapas não gosta de rajada). */
export async function emParalelo<T, R>(itens: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    for (let i = proximo++; i < itens.length; i = proximo++) saida[i] = await fn(itens[i]);
  }));
  return saida;
}

export const paraPessoa = (c: ColaboradorDb, ponto: Ponto | null): PessoaExtra => ({
  id: c.id, nome: c.nome, endereco: c.endereco ?? "", bairro: c.bairro, cidade: c.cidade, uf: c.uf, ponto,
  onde: { cidade: c.cidade, bairros: c.bairro ? [c.bairro] : [], texto: textoEndereco(c) },
});

/** Km real do carro (cada perna pelo menor trajeto, com cache de 30 dias). Null se alguma perna falhar. */
export async function kmRealDoCarro(db: SupabaseClient, carro: CarroPlano, unidade: Ponto, sentido: Sentido): Promise<{ km: number; estimado: boolean } | null> {
  if (carro.semLocal) return null;
  const seq = percurso(carro, unidade, sentido);
  try {
    const pernas = await Promise.all(seq.slice(1).map((p, i) => rotaComCache(db, seq[i], p)));
    return { km: Math.round(pernas.reduce((s, r) => s + r.km, 0) * 100) / 100, estimado: pernas.some((r) => r.fonte === "estimada") };
  } catch { return null; }
}
