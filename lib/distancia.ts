export type Ponto = { lat: number; lng: number };
/** De onde veio a distância: Google Routes, OpenRouteService, OSRM público ou estimativa (linha reta × 1,3). */
export type FonteDistancia = "google" | "ors" | "osrm" | "estimada";

/** Distância em linha reta (km), pela fórmula de haversine. */
export function distanciaReta(a: Ponto, b: Ponto): number {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const km = (metros: number) => Math.round(metros / 10) / 100;

/** Distância (km) e caminho (pontos da linha da rota, quando o serviço devolve). */
export type Rota = { km: number; caminho: Ponto[] };

/** Entre as rotas devolvidas, a de menor distância, com o caminho decodificado. */
function menorRota(rotas: { metros: unknown; polyline?: string }[]): Rota | null {
  const validas = rotas.filter((r) => r.metros != null && Number.isFinite(Number(r.metros)) && Number(r.metros) >= 0);
  if (!validas.length) return null;
  const melhor = validas.reduce((m, r) => (Number(r.metros) < Number(m.metros) ? r : m));
  let caminho: Ponto[] = [];
  try { caminho = melhor.polyline ? decodificarPolyline(melhor.polyline) : []; } catch { caminho = []; }
  return { km: km(Number(melhor.metros)), caminho };
}

/** Entre as rotas devolvidas, a de menor distância (km). Null se nenhuma tiver distância válida. */
export function menorKm(metros: unknown[]): number | null {
  const validos = metros.filter((m) => m != null && m !== "").map(Number).filter((m) => Number.isFinite(m) && m >= 0);
  return validos.length ? km(Math.min(...validos)) : null;
}

/**
 * Rota de carro pelo Google Routes API (chave GOOGLE_MAPS_API_KEY, com a "Routes API" ativada no Google Cloud).
 * Sem trânsito (TRAFFIC_UNAWARE): é o nível mais barato e a distância não muda com o horário.
 */
async function rotaGoogle(a: Ponto, b: Ponto): Promise<Rota | null> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave) return null;
  const ponto = (p: Ponto) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { "X-Goog-Api-Key": chave, "X-Goog-FieldMask": "routes.distanceMeters,routes.polyline.encodedPolyline", "Content-Type": "application/json" },
      // Pede também as rotas alternativas e fica com a de menor km (mesmo que demore mais)
      body: JSON.stringify({ origin: ponto(a), destination: ponto(b), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: true, languageCode: "pt-BR", units: "METRIC" }),
    });
    if (!resp.ok) { console.error("Google Routes respondeu", resp.status, (await resp.text()).slice(0, 300)); return null; }
    return menorRota(((await resp.json())?.routes ?? []).map((r: any) => ({ metros: r?.distanceMeters, polyline: r?.polyline?.encodedPolyline })));
  } catch { return null; }
}

/**
 * Diagnóstico da chave do Google (para /api/saude): chama a Routes API e a Geocoding API e devolve
 * o erro exato que o Google respondeu em cada uma.
 */
export async function diagnosticoGoogle(): Promise<{ rotas: string | null; enderecos: string | null; sugestoes: string | null }> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave) return { rotas: "GOOGLE_MAPS_API_KEY vazia", enderecos: "GOOGLE_MAPS_API_KEY vazia", sugestoes: "GOOGLE_MAPS_API_KEY vazia" };
  let rotas: string | null = null, enderecos: string | null = null, sugestoes: string | null = null;
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(6000),
      headers: { "X-Goog-Api-Key": chave, "X-Goog-FieldMask": "routes.distanceMeters", "Content-Type": "application/json" },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: -22.8546, longitude: -46.3178 } } }, destination: { location: { latLng: { latitude: -22.8743, longitude: -46.3233 } } }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
    });
    if (!r.ok) { const j = await r.json().catch(() => null); rotas = `${r.status} ${j?.error?.status ?? ""}: ${j?.error?.message ?? "sem detalhe"}`.slice(0, 400); }
  } catch (e) { rotas = `sem conexão: ${e instanceof Error ? e.message : e}`; }
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent("Extrema, MG")}&key=${chave}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const j = await r.json().catch(() => null);
    if (j?.status !== "OK") enderecos = `${j?.status ?? r.status}: ${j?.error_message ?? "sem detalhe"}`.slice(0, 400);
  } catch (e) { enderecos = `sem conexão: ${e instanceof Error ? e.message : e}`; }
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(6000),
      headers: { "X-Goog-Api-Key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Pronto Socorro Extrema", includedRegionCodes: ["br"] }),
    });
    if (!r.ok) { const j = await r.json().catch(() => null); sugestoes = `${r.status} ${j?.error?.status ?? ""}: ${j?.error?.message ?? "sem detalhe"}`.slice(0, 400); }
  } catch (e) { sugestoes = `sem conexão: ${e instanceof Error ? e.message : e}`; }
  return { rotas, enderecos, sugestoes };
}

/** Rota de carro pelo OpenRouteService (chave ORS_API_KEY; plano gratuito). Null se não houver chave ou não responder. */
async function rotaOrs(a: Ponto, b: Ponto): Promise<Rota | null> {
  const chave = process.env.ORS_API_KEY?.trim();
  if (!chave) return null;
  try {
    const resp = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { Authorization: chave, "Content-Type": "application/json", Accept: "application/json" },
      // "shortest": a rota de menor distância, não a mais rápida
      body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]], preference: "shortest", instructions: false }),
    });
    if (!resp.ok) { console.error("OpenRouteService respondeu", resp.status, (await resp.text()).slice(0, 200)); return null; }
    const r0 = (await resp.json())?.routes?.[0];
    return menorRota([{ metros: r0?.summary?.distance, polyline: typeof r0?.geometry === "string" ? r0.geometry : undefined }]);
  } catch { return null; }
}

/** Rota pelo servidor público do OSRM (sem garantia; só reserva). */
async function rotaOsrm(a: Ponto, b: Ponto): Promise<Rota | null> {
  try {
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline&alternatives=3`, {
      signal: AbortSignal.timeout(3000), headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store",
    });
    return resp.ok ? menorRota(((await resp.json())?.routes ?? []).map((r: any) => ({ metros: r?.distance, polyline: r?.geometry }))) : null;
  } catch { return null; }
}

/**
 * Rota por ruas, sempre a de MENOR distância (não a mais rápida): Google Routes; sem chave ou com falha,
 * OpenRouteService; depois, OSRM público; por último, a linha reta × 1,3 (sem caminho).
 */
export async function rotaCompleta(a: Ponto, b: Ponto): Promise<Rota & { fonte: FonteDistancia }> {
  if (distanciaReta(a, b) < 0.05) return { km: 0, caminho: [], fonte: "estimada" };
  const google = await rotaGoogle(a, b);
  if (google) return { ...google, fonte: "google" };
  const ors = await rotaOrs(a, b);
  if (ors) return { ...ors, fonte: "ors" };
  const osrm = await rotaOsrm(a, b);
  if (osrm) return { ...osrm, fonte: "osrm" };
  return { km: Math.round(distanciaReta(a, b) * 1.3 * 100) / 100, caminho: [], fonte: "estimada" };
}

/** Só a distância do menor trajeto (km) e de onde veio. */
export async function rotaEntre(a: Ponto, b: Ponto): Promise<{ km: number; fonte: FonteDistancia }> {
  const r = await rotaCompleta(a, b);
  return { km: r.km, fonte: r.fonte };
}

/** Só os km (compatibilidade com quem já usava). */
export async function distanciaTrajeto(a: Ponto, b: Ponto): Promise<number> {
  return (await rotaEntre(a, b)).km;
}

/** Decodifica uma polyline codificada (formato do Google, precisão 5) em pontos. */
export function decodificarPolyline(codigo: string): Ponto[] {
  const pontos: Ponto[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < codigo.length) {
    for (const eixo of [0, 1]) {
      let res = 0, desloc = 0, b: number;
      do { b = codigo.charCodeAt(i++) - 63; res |= (b & 0x1f) << desloc; desloc += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (eixo === 0) lat += d; else lng += d;
    }
    pontos.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pontos;
}

/**
 * Pontos de passagem para "prender" o caminho no Google Maps: os pontos a 1/3 e 2/3 da distância do trajeto.
 * Trajetos curtos (menos de 2 km) ou sem caminho não precisam.
 */
export function pontosDePassagem(caminho: Ponto[], quantos = 2): Ponto[] {
  if (caminho.length < 3) return [];
  const acum = [0];
  for (let i = 1; i < caminho.length; i++) acum.push(acum[i - 1] + distanciaReta(caminho[i - 1], caminho[i]));
  const total = acum[acum.length - 1];
  if (total < 2) return [];
  const saida: Ponto[] = [];
  for (let k = 1; k <= quantos; k++) {
    const alvo = (total * k) / (quantos + 1);
    const i = acum.findIndex((d) => d >= alvo);
    if (i > 0) saida.push(caminho[i]);
  }
  return saida;
}

/** Link do Google Maps com o trajeto de carro, passando pelos pontos que mantêm o menor caminho. */
export function linkRoteiro(a: Ponto, b: Ponto, passagem: Ponto[] = []): string {
  const f = (p: Ponto) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const via = passagem.length ? `&waypoints=${encodeURIComponent(passagem.map(f).join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${f(a)}&destination=${f(b)}${via}&travelmode=driving`;
}
