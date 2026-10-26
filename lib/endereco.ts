/** Monta "Rua X, 123 - Bairro, Cidade - UF" a partir da resposta do Nominatim (OpenStreetMap). */
export function enderecoDoNominatim(r: any): string | null {
  const a = r?.address ?? {};
  const rua = a.road ?? a.pedestrian ?? a.footway ?? a.residential ?? null;
  const bairro = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null;
  const cidade = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
  const uf = String(a["ISO3166-2-lvl4"] ?? "").replace(/^BR-/, "") || null;
  const linha1 = rua ? [rua, a.house_number].filter(Boolean).join(", ") : a.amenity ?? null;
  const partes = [linha1, bairro].filter(Boolean).join(" - ");
  const fim = [cidade, uf].filter(Boolean).join(" - ");
  const texto = [partes, fim].filter(Boolean).join(", ");
  return texto || r?.display_name || null;
}

/**
 * Endereço escrito a partir de coordenadas (geocodificação reversa gratuita do Nominatim/OpenStreetMap).
 * Devolve null se o serviço não responder em 5 s; quem chama segue com as coordenadas.
 */
export async function enderecoPorCoordenadas(lat: number, lng: number, identificacao = "app interno"): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`,
      { headers: { "User-Agent": `ControleDeTaxis/1.0 (${identificacao})` }, cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    if (!resp.ok) return null;
    return enderecoDoNominatim(await resp.json());
  } catch { return null; }
}

export type Sugestao = { endereco: string; detalhe: string; lat: number; lng: number };

const UF: Record<string, string> = {
  Acre: "AC", Alagoas: "AL", Amapá: "AP", Amazonas: "AM", Bahia: "BA", Ceará: "CE", "Distrito Federal": "DF", "Espírito Santo": "ES",
  Goiás: "GO", Maranhão: "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", Pará: "PA", Paraíba: "PB",
  Paraná: "PR", Pernambuco: "PE", Piauí: "PI", "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS",
  Rondônia: "RO", Roraima: "RR", "Santa Catarina": "SC", "São Paulo": "SP", Sergipe: "SE", Tocantins: "TO",
};

/** Converte a resposta do Photon (GeoJSON) em sugestões "Rua X, 123 - Bairro, Cidade - UF", sem repetidas. */
export function sugestoesDoPhoton(geo: any): Sugestao[] {
  const vistas = new Set<string>();
  const lista: Sugestao[] = [];
  for (const f of geo?.features ?? []) {
    const p = f?.properties ?? {};
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const uf = UF[p.state] ?? p.state ?? null;
    const rua = p.street ? [p.street, p.housenumber].filter(Boolean).join(", ") : null;
    const lugar = p.name && p.name !== p.street ? p.name : null;
    const linha1 = [lugar, rua].filter(Boolean).join(" · ") || p.name;
    const bairro = p.district ?? p.locality ?? null;
    const cidade = p.city ?? p.county ?? null;
    if (!linha1) continue;
    const endereco = [[linha1, bairro].filter(Boolean).join(" - "), [cidade, uf].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
    if (vistas.has(endereco)) continue;
    vistas.add(endereco);
    lista.push({ endereco, detalhe: [bairro, cidade, uf].filter(Boolean).join(", "), lat, lng });
  }
  return lista;
}
