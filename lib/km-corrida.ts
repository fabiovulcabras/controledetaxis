import type { SupabaseClient } from "@supabase/supabase-js";
import { rotaEntre, type FonteDistancia, type Ponto } from "./distancia";
import { normalizar } from "./precos";
import { ordenarDestinos, paradasDa } from "./multidestino";

/** Centro de Extrema: puxa a busca de endereços escritos para a região das corridas. */
const REGIAO = { lat: -22.854, lng: -46.318 };

type Corr = {
  id: string; origem: string; destino: string;
  origem_lat?: number | null; origem_lng?: number | null; destino_lat?: number | null; destino_lng?: number | null;
  distancia_km?: number | null; distancia_fonte?: string | null; paradas?: unknown;
};
type Lugar = { nome: string; endereco: string; lat: number | null; lng: number | null };

/**
 * Coordenadas de um endereço escrito pelo Google Geocoding (chave GOOGLE_MAPS_API_KEY, com a "Geocoding API" ativada),
 * priorizando a região de Extrema. Null sem chave, sem resultado ou com erro.
 */
async function coordenadasGoogle(texto: string): Promise<(Ponto & { google: true }) | null> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave) return null;
  const caixa = `${REGIAO.lat - 0.6},${REGIAO.lng - 0.6}|${REGIAO.lat + 0.6},${REGIAO.lng + 0.6}`;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(texto.slice(0, 200))}&bounds=${encodeURIComponent(caixa)}&region=br&components=country:BR&language=pt-BR&key=${chave}`, {
      cache: "no-store", signal: AbortSignal.timeout(4000),
    });
    const j = await r.json().catch(() => null);
    if (j?.status && !["OK", "ZERO_RESULTS"].includes(j.status)) console.error("Google Geocoding:", j.status, j.error_message ?? "");
    const loc = j?.results?.[0]?.geometry?.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng, google: true } : null;
  } catch { return null; }
}

/** Coordenadas de um endereço escrito: Google Geocoding; sem chave ou sem resultado, Photon (OpenStreetMap). */
export async function coordenadasDoTexto(texto: string): Promise<(Ponto & { google?: true }) | null> {
  if (String(texto).trim().length < 4) return null;
  const g = await coordenadasGoogle(texto);
  if (g) return g;
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(texto.slice(0, 160))}&limit=1&lat=${REGIAO.lat}&lon=${REGIAO.lng}&bbox=-74.0,-33.8,-34.7,5.3`, {
      headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store", signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const [lng, lat] = (await r.json())?.features?.[0]?.geometry?.coordinates ?? [];
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; }
}

/** Ponto de um local cadastrado cujo nome, endereço ou "nome – endereço" é o texto da corrida. */
export function pontoCadastrado(texto: string, lugares: Lugar[]): Ponto | null {
  const t = normalizar(texto);
  if (!t) return null;
  const l = lugares.find((x) => x.lat != null && x.lng != null &&
    [x.nome, x.endereco, `${x.nome} – ${x.endereco}`, `${x.nome} - ${x.endereco}`].some((v) => normalizar(v) === t));
  return l ? { lat: l.lat!, lng: l.lng! } : null;
}

async function lugaresCadastrados(db: SupabaseClient): Promise<Lugar[]> {
  const [u, l] = await Promise.all([
    db.from("unidades").select("nome,endereco_padrao,lat,lng").eq("ativo", true),
    db.from("locais").select("nome,endereco,lat,lng").eq("ativo", true),
  ]);
  return [
    ...(u.data ?? []).map((x: any) => ({ nome: x.nome, endereco: String(x.endereco_padrao ?? ""), lat: x.lat, lng: x.lng })),
    ...(l.error ? [] : l.data ?? []).map((x: any) => ({ nome: x.nome, endereco: String(x.endereco ?? ""), lat: x.lat, lng: x.lng })),
  ];
}

type PontoResolvido = { p: Ponto; novo: boolean };

/**
 * Ponto de um endereço: as coordenadas guardadas; sem elas, um local cadastrado com o mesmo texto; por último,
 * o endereço escrito buscado no mapa. `novo`: o ponto pode ser gravado na corrida (não veio do Google).
 */
async function resolverPonto(lat: unknown, lng: unknown, texto: string, lugares: Lugar[]): Promise<PontoResolvido | null> {
  if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return { p: { lat: Number(lat), lng: Number(lng) }, novo: false };
  const cad = pontoCadastrado(texto, lugares);
  if (cad) return { p: cad, novo: true };
  // Coordenadas do Google não ficam gravadas (os termos do Google Maps limitam guardar o resultado); só a distância
  const g = await coordenadasDoTexto(texto);
  return g ? { p: { lat: g.lat, lng: g.lng }, novo: !g.google } : null;
}

/** Pontos de origem, paradas (na ordem gravada) e destino final da corrida. Null se algum não for achado. */
export async function pontosDaCorrida(db: SupabaseClient, c: Corr, cacheLugares?: Lugar[]): Promise<{ o: PontoResolvido; paradas: PontoResolvido[]; d: PontoResolvido } | null> {
  const lugares = cacheLugares ?? await lugaresCadastrados(db);
  const o = await resolverPonto(c.origem_lat, c.origem_lng, c.origem, lugares);
  if (!o) return null;
  const paradas: PontoResolvido[] = [];
  for (const x of paradasDa(c)) {
    const p = await resolverPonto(x.lat, x.lng, x.texto, lugares);
    if (!p) return null;
    paradas.push(p);
  }
  const d = await resolverPonto(c.destino_lat, c.destino_lng, c.destino, lugares);
  return d ? { o, paradas, d } : null;
}

/** Junta a fonte de várias pernas: basta uma estimada para o total ser estimado. */
const fonteDoTotal = (fontes: FonteDistancia[]): FonteDistancia => (fontes.includes("estimada") ? "estimada" : fontes[0] ?? "estimada");

/**
 * Calcula e grava o km rodado da corrida: origem → paradas → destino final, cada perna pelo menor trajeto.
 * Sem `forcar`, não refaz quem já tem distância por rota.
 */
export async function garantirDistancia(db: SupabaseClient, c: Corr, forcar = false, cacheLugares?: Lugar[]): Promise<{ km: number; fonte: FonteDistancia } | null> {
  if (!forcar && c.distancia_km != null && c.distancia_fonte && c.distancia_fonte !== "estimada") return { km: Number(c.distancia_km), fonte: c.distancia_fonte as FonteDistancia };
  const pts = await pontosDaCorrida(db, c, cacheLugares);
  if (!pts) return null;
  const { o, d } = pts;
  const seq = [o, ...pts.paradas, d];
  const pernas = await Promise.all(seq.slice(1).map((p, i) => rotaEntre(seq[i].p, p.p)));
  const rota = { km: Math.round(pernas.reduce((s, r) => s + r.km, 0) * 100) / 100, fonte: fonteDoTotal(pernas.map((r) => r.fonte)) };
  const campos: Record<string, unknown> = { distancia_km: rota.km, distancia_fonte: rota.fonte, distancia_calculada_em: new Date().toISOString() };
  if (o.novo) Object.assign(campos, { origem_lat: o.p.lat, origem_lng: o.p.lng });
  if (d.novo) Object.assign(campos, { destino_lat: d.p.lat, destino_lng: d.p.lng });
  let { error } = await db.from("corridas").update(campos).eq("id", c.id);
  if (error && /distancia_fonte|distancia_calculada_em/.test(error.message)) {
    // Sem a migração 016 (colunas) ou a 018 (fonte "google"): grava só a distância
    delete campos.distancia_fonte; delete campos.distancia_calculada_em;
    ({ error } = await db.from("corridas").update(campos).eq("id", c.id));
  }
  if (error) { console.error("Gravar distância", error.message); return null; }
  Object.assign(c, campos);
  return rota;
}

type Endereco = { texto: string; lat: number | null; lng: number | null };

/**
 * Vários destinos: acha o ponto de cada um, mede as distâncias (origem → cada destino e entre os destinos,
 * pelo menor trajeto) e escolhe o final (o mais longe da origem) e a ordem das paradas de menor km rodado.
 * Null se algum endereço não for achado no mapa: aí vale a ordem digitada.
 */
export async function otimizarDestinos(db: SupabaseClient, origem: Endereco, destinos: Endereco[]): Promise<{ ordem: number[]; km: number; fonte: FonteDistancia } | null> {
  if (destinos.length < 2) return null;
  const lugares = await lugaresCadastrados(db);
  const o = await resolverPonto(origem.lat, origem.lng, origem.texto, lugares);
  const ds = await Promise.all(destinos.map((x) => resolverPonto(x.lat, x.lng, x.texto, lugares)));
  if (!o || ds.some((x) => !x)) return null;
  const pts = ds as PontoResolvido[];
  const n = pts.length;
  const fontes: FonteDistancia[] = [];
  const medir = async (a: Ponto, b: Ponto) => { const r = await rotaEntre(a, b); fontes.push(r.fonte); return r.km; };
  const daOrigem = await Promise.all(pts.map((p) => medir(o.p, p.p)));
  const entre: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  await Promise.all(pts.flatMap((a, i) => pts.map(async (b, j) => { if (i !== j) entre[i][j] = await medir(a.p, b.p); })));
  const r = ordenarDestinos(daOrigem, entre);
  return { ordem: r.ordem, km: r.km, fonte: fonteDoTotal(fontes) };
}

export { lugaresCadastrados };
