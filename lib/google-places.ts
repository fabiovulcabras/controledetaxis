// Busca de endereços pelo Google Places API (New): sugestões enquanto a pessoa digita e o ponto do lugar escolhido.
// Exige GOOGLE_MAPS_API_KEY com a "Places API (New)" ativada. Usa token de sessão: as sugestões de uma busca
// que termina na escolha de um lugar são cobradas como uma única sessão.

const BASE = "https://places.googleapis.com/v1";
const EXTREMA = { latitude: -22.854, longitude: -46.318 };

export type SugestaoGoogle = { endereco: string; detalhe: string; placeId: string };
export const googleAtivo = () => !!process.env.GOOGLE_MAPS_API_KEY?.trim();
const limpar = (t: string) => t.replace(/,?\s*(Brasil|Brazil)$/i, "").replace(/,?\s*\d{5}-?\d{3}/, "").trim();

/** Sugestões do Google para o texto digitado, priorizando a região (ou o ponto `perto`). Null se o Google falhar. */
export async function sugestoesGoogle(q: string, sessao: string, perto?: { lat: number; lng: number } | null): Promise<SugestaoGoogle[] | null> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave) return null;
  try {
    const r = await fetch(`${BASE}/places:autocomplete`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(4000),
      headers: { "X-Goog-Api-Key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: q, sessionToken: sessao || undefined, languageCode: "pt-BR", regionCode: "br", includedRegionCodes: ["br"],
        locationBias: { circle: { center: perto ? { latitude: perto.lat, longitude: perto.lng } : EXTREMA, radius: 50000 } },
      }),
    });
    if (!r.ok) { console.error("Google Places (sugestões)", r.status, (await r.text()).slice(0, 300)); return null; }
    const j = await r.json();
    return (j?.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean).slice(0, 5).map((p: any) => {
      const principal = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
      const secundario = limpar(p.structuredFormat?.secondaryText?.text ?? "");
      return { endereco: secundario ? `${principal}, ${secundario}` : principal, detalhe: secundario, placeId: String(p.placeId) };
    });
  } catch { return null; }
}

/** Texto e ponto do lugar escolhido (encerra a sessão de busca). Null se o Google falhar. */
export async function lugarGoogle(placeId: string, sessao: string): Promise<{ endereco: string; lat: number; lng: number } | null> {
  const chave = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!chave || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null;
  try {
    const r = await fetch(`${BASE}/places/${placeId}?languageCode=pt-BR&regionCode=br${sessao ? `&sessionToken=${encodeURIComponent(sessao)}` : ""}`, {
      cache: "no-store", signal: AbortSignal.timeout(4000),
      headers: { "X-Goog-Api-Key": chave, "X-Goog-FieldMask": "location,formattedAddress,displayName,types" },
    });
    if (!r.ok) { console.error("Google Places (lugar)", r.status, (await r.text()).slice(0, 300)); return null; }
    const j = await r.json();
    const lat = j?.location?.latitude, lng = j?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const endereco = limpar(String(j.formattedAddress ?? ""));
    const nome = String(j.displayName?.text ?? "");
    // Estabelecimento (hospital, aeroporto...): "Nome – endereço"; endereço puro: só o endereço
    const texto = nome && !endereco.toLowerCase().startsWith(nome.toLowerCase()) && !/^(street_address|premise|route|subpremise)$/.test((j.types ?? [])[0] ?? "")
      ? `${nome} – ${endereco}` : endereco || nome;
    return { endereco: texto, lat, lng };
  } catch { return null; }
}
