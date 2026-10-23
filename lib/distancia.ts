type Ponto = { lat: number; lng: number };

/** Distância em linha reta (km), pela fórmula de haversine. */
export function distanciaReta(a: Ponto, b: Ponto): number {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Distância do trajeto por ruas (km), pelo servidor público do OSRM (gratuito, uso leve).
 * Se ele não responder em 3 s, usa a linha reta × 1,3, aproximação comum para trajetos urbanos.
 */
export async function distanciaTrajeto(a: Ponto, b: Ponto): Promise<number> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, {
      signal: ctrl.signal, headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store",
    });
    clearTimeout(t);
    const j: any = await resp.json();
    const metros = j?.routes?.[0]?.distance;
    if (resp.ok && Number.isFinite(metros)) return Math.round(metros / 10) / 100;
  } catch { /* usa a aproximação abaixo */ }
  return Math.round(distanciaReta(a, b) * 1.3 * 100) / 100;
}
