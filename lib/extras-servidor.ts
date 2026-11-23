import type { SupabaseClient } from "@supabase/supabase-js";
import { distanciaReta, type Ponto } from "./distancia";
import { coordenadasDoTexto } from "./km-corrida";
import type { PessoaExtra } from "./extras-rota";

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
/** Casa a mais de tantos km do centro da cidade do cadastro é endereço achado no lugar errado (cidade/bairro homônimo). */
export const RAIO_CIDADE_KM = 30;
const centrosDeCidade = new Map<string, Promise<Ponto | null>>();
function centroDaCidade(c: ColaboradorDb): Promise<Ponto | null> {
  const texto = cidadeUf(c) + ", Brasil";
  if (!centrosDeCidade.has(texto)) {
    centrosDeCidade.set(texto, coordenadasDoTexto(texto).then((g) => (g ? { lat: g.lat, lng: g.lng } : null)).catch(() => null));
  }
  return centrosDeCidade.get(texto)!;
}

export async function localizarCasa(c: ColaboradorDb): Promise<{ ponto: Ponto | null; precisao: Precisao }> {
  if (!c.cidade) return { ponto: null, precisao: "nenhuma" };
  const centro = await centroDaCidade(c);
  const tentativas: [string, Precisao][] = [
    [textoEndereco(c) + ", Brasil", "endereco"],
    [[c.bairro, cidadeUf(c)].filter(Boolean).join(", ") + ", Brasil", "bairro"],
  ];
  const vistos = new Set<string>();
  for (const [texto, precisao] of tentativas) {
    if (vistos.has(texto)) continue;
    if (precisao === "endereco" && !c.endereco) continue;
    if (precisao === "bairro" && !c.bairro) continue;
    vistos.add(texto);
    const g = await coordenadasDoTexto(texto);
    if (!g) continue;
    const ponto = { lat: g.lat, lng: g.lng };
    // Fora da cidade do cadastro: descarta e tenta uma busca mais geral
    if (centro && distanciaReta(centro, ponto) > RAIO_CIDADE_KM) continue;
    return { ponto, precisao };
  }
  return centro ? { ponto: centro, precisao: "cidade" } : { ponto: null, precisao: "nenhuma" };
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

/** Coordenadas guardadas valem 30 dias (limite para guardar o resultado do Google); depois a casa é buscada de novo. */
export const GEO_VALIDADE_DIAS = 30;
export type ColaboradorGeo = ColaboradorDb & { ativo: boolean; lat: number | null; lng: number | null; geo_precisao: Precisao | null; geo_em: string | null };
const COLUNAS_GEO = "id,codigo,nome,endereco,bairro,cidade,uf,cep,ativo,lat,lng,geo_precisao,geo_em";
export const geoValida = (c: Pick<ColaboradorGeo, "lat" | "lng" | "geo_em">) =>
  c.lat != null && c.lng != null && !!c.geo_em && Date.now() - new Date(c.geo_em).getTime() < GEO_VALIDADE_DIAS * 86400_000;

/** Lê os colaboradores em lotes de 100 ids (a lista vai na URL da consulta; com 400 ids passaria do limite). */
export async function lerColaboradores(db: SupabaseClient, ids: string[]): Promise<ColaboradorGeo[]> {
  const saida: ColaboradorGeo[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("colaboradores").select(COLUNAS_GEO).in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as ColaboradorGeo[]));
  }
  return saida;
}

/** Ponto guardado do colaborador (null se não tem ou venceu). */
export const pontoGuardado = (c: ColaboradorGeo): Ponto | null => (geoValida(c) ? { lat: Number(c.lat), lng: Number(c.lng) } : null);

/** Ponto da unidade: o guardado em Cadastros › Unidades; sem ele, busca o endereço no mapa. */
export async function pontoDaUnidade(unidade: { nome: string; endereco_padrao: string | null; lat: number | null; lng: number | null }): Promise<{ ponto: Ponto | null; texto: string }> {
  const texto = String(unidade.endereco_padrao ?? "").trim() || unidade.nome;
  if (unidade.lat != null && unidade.lng != null) return { ponto: { lat: Number(unidade.lat), lng: Number(unidade.lng) }, texto };
  const g = await coordenadasDoTexto(texto);
  return { ponto: g ? { lat: g.lat, lng: g.lng } : null, texto };
}
