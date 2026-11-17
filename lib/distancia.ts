export type Ponto = { lat: number; lng: number };
/** De onde veio a distância: OpenRouteService, OSRM público ou estimativa (linha reta × 1,3). */
export type FonteDistancia = "ors" | "osrm" | "estimada";

/** Distância em linha reta (km), pela fórmula de haversine. */
export function distanciaReta(a: Ponto, b: Ponto): number {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

const km = (metros: number) => Math.round(metros / 10) / 100;

/** Rota de carro pelo OpenRouteService (chave ORS_API_KEY; plano gratuito). Null se não houver chave ou não responder. */
async function rotaOrs(a: Ponto, b: Ponto): Promise<number | null> {
  const chave = process.env.ORS_API_KEY?.trim();
  if (!chave) return null;
  try {
    const resp = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { Authorization: chave, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]], instructions: false }),
    });
    if (!resp.ok) { console.error("OpenRouteService respondeu", resp.status, (await resp.text()).slice(0, 200)); return null; }
    const metros = (await resp.json())?.routes?.[0]?.summary?.distance;
    return Number.isFinite(metros) ? km(metros) : null;
  } catch { return null; }
}

/** Rota pelo servidor público do OSRM (sem garantia; só reserva). */
async function rotaOsrm(a: Ponto, b: Ponto): Promise<number | null> {
  try {
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, {
      signal: AbortSignal.timeout(3000), headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store",
    });
    const metros = (await resp.json())?.routes?.[0]?.distance;
    return resp.ok && Number.isFinite(metros) ? km(metros) : null;
  } catch { return null; }
}

/**
 * Distância do trajeto por ruas (km): OpenRouteService; se não houver chave ou falhar, OSRM público;
 * por último, a linha reta × 1,3 (aproximação comum para trajetos urbanos).
 */
export async function rotaEntre(a: Ponto, b: Ponto): Promise<{ km: number; fonte: FonteDistancia }> {
  if (distanciaReta(a, b) < 0.05) return { km: 0, fonte: "estimada" };
  const ors = await rotaOrs(a, b);
  if (ors != null) return { km: ors, fonte: "ors" };
  const osrm = await rotaOsrm(a, b);
  if (osrm != null) return { km: osrm, fonte: "osrm" };
  return { km: Math.round(distanciaReta(a, b) * 1.3 * 100) / 100, fonte: "estimada" };
}

/** Só os km (compatibilidade com quem já usava). */
export async function distanciaTrajeto(a: Ponto, b: Ponto): Promise<number> {
  return (await rotaEntre(a, b)).km;
}
