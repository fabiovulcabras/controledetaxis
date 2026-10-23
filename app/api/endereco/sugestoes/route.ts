import { sugestoesDoPhoton } from "@/lib/endereco";

import { dentroDoLimite, muitasTentativas, solicitantePorToken, tokenValido } from "@/lib/links-api";

export const dynamic = "force-dynamic";
const LIMITE = 60;

/**
 * Sugestões de endereço enquanto a pessoa digita (Photon, serviço gratuito sobre o OpenStreetMap, sem chave).
 * Busca só no Brasil e dá preferência a resultados perto de lat/lng, quando informados.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  // Só para quem está com um link de pedido válido, e com limite por minuto: evita que a rota vire um proxy aberto
  const token = u.searchParams.get("t");
  if (!tokenValido(token) || !(await solicitantePorToken(token).catch(() => null))) return Response.json({ erro: "Link inválido." }, { status: 403 });
  if (!(await dentroDoLimite(`sugestao:${token}`, LIMITE, 60))) return muitasTentativas();
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 3) return Response.json({ sugestoes: [] });
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  const perto = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? `&lat=${lat}&lon=${lng}` : "";
  try {
    const resp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=-74.0,-33.8,-34.7,5.3${perto}`, {
      headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return Response.json({ sugestoes: sugestoesDoPhoton(await resp.json()).slice(0, 5) });
  } catch {
    // Sem sugestões a pessoa ainda pode digitar o endereço inteiro
    return Response.json({ sugestoes: [], erro: "Sugestões indisponíveis no momento." });
  }
}
