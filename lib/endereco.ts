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
