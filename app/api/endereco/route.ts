import { enderecoDoNominatim } from "@/lib/endereco";
import { urlApp } from "@/lib/whatsapp/link";

import { dentroDoLimite, muitasTentativas, solicitantePorToken, tokenValido } from "@/lib/links-api";

export const dynamic = "force-dynamic";
const LIMITE = 20;

/**
 * Converte a localização do celular em endereço escrito (geocodificação reversa gratuita do OpenStreetMap/Nominatim).
 * A política do Nominatim pede identificação do app e no máximo 1 consulta por segundo; o uso aqui é pontual.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  // Só para quem está com um link de pedido válido, e com limite por minuto: evita que a rota vire um proxy aberto
  const token = u.searchParams.get("t");
  if (!tokenValido(token) || !(await solicitantePorToken(token).catch(() => null))) return Response.json({ erro: "Link inválido." }, { status: 403 });
  if (!(await dentroDoLimite(`endereco:${token}`, LIMITE, 60))) return muitasTentativas();
  const lat = Number(u.searchParams.get("lat"));
  const lng = Number(u.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ erro: "Localização inválida." }, { status: 400 });
  }
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`,
      { headers: { "User-Agent": `ControleDeTaxis/1.0 (${urlApp(req) || "app interno"})` }, cache: "no-store" },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const endereco = enderecoDoNominatim(await resp.json());
    if (!endereco) throw new Error("sem endereço");
    return Response.json({ endereco });
  } catch {
    return Response.json({ erro: "Não foi possível descobrir o endereço. Digite a origem." }, { status: 502 });
  }
}
