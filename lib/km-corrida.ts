import type { SupabaseClient } from "@supabase/supabase-js";
import { rotaEntre, type FonteDistancia, type Ponto } from "./distancia";
import { normalizar } from "./precos";

/** Centro de Extrema: puxa a busca de endereços escritos para a região das corridas. */
const REGIAO = { lat: -22.854, lng: -46.318 };

type Corr = {
  id: string; origem: string; destino: string;
  origem_lat?: number | null; origem_lng?: number | null; destino_lat?: number | null; destino_lng?: number | null;
  distancia_km?: number | null; distancia_fonte?: string | null;
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

/**
 * Pontos de origem e destino da corrida: as coordenadas guardadas; sem elas, um local cadastrado com o mesmo texto;
 * por último, o endereço escrito buscado no mapa. `novo`: o ponto pode ser gravado na corrida (não veio do Google).
 */
export async function pontosDaCorrida(db: SupabaseClient, c: Corr, cacheLugares?: Lugar[]): Promise<{ o: { p: Ponto; novo: boolean }; d: { p: Ponto; novo: boolean } } | null> {
  const lugares = cacheLugares ?? await lugaresCadastrados(db);
  const ponto = async (lat: unknown, lng: unknown, texto: string) => {
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return { p: { lat: Number(lat), lng: Number(lng) }, novo: false };
    const cad = pontoCadastrado(texto, lugares);
    if (cad) return { p: cad, novo: true };
    // Coordenadas do Google não ficam gravadas (os termos do Google Maps limitam guardar o resultado); só a distância
    const g = await coordenadasDoTexto(texto);
    return g ? { p: { lat: g.lat, lng: g.lng }, novo: !g.google } : null;
  };
  const o = await ponto(c.origem_lat, c.origem_lng, c.origem);
  const d = o ? await ponto(c.destino_lat, c.destino_lng, c.destino) : null;
  return o && d ? { o, d } : null;
}

/**
 * Calcula e grava a distância da corrida (origem → destino, por ruas). Usa as coordenadas guardadas; sem elas,
 * um local cadastrado com o mesmo texto; por último, busca o endereço escrito no mapa (e guarda as coordenadas achadas).
 * Sem `forcar`, não refaz quem já tem distância por rota.
 */
export async function garantirDistancia(db: SupabaseClient, c: Corr, forcar = false, cacheLugares?: Lugar[]): Promise<{ km: number; fonte: FonteDistancia } | null> {
  if (!forcar && c.distancia_km != null && c.distancia_fonte && c.distancia_fonte !== "estimada") return { km: Number(c.distancia_km), fonte: c.distancia_fonte as FonteDistancia };
  const pts = await pontosDaCorrida(db, c, cacheLugares);
  if (!pts) return null;
  const { o, d } = pts;
  const rota = await rotaEntre(o.p, d.p);
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

export { lugaresCadastrados };
