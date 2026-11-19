import { lugarGoogle } from "@/lib/google-places";
import { dentroDoLimite, muitasTentativas, solicitantePorToken, tokenValido } from "@/lib/links-api";

export const dynamic = "force-dynamic";

/** Ponto e texto da sugestão do Google escolhida no pedido (?t=token do link&id=placeId&s=sessão). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("t");
  if (!tokenValido(token) || !(await solicitantePorToken(token).catch(() => null))) return Response.json({ erro: "Link inválido." }, { status: 403 });
  if (!(await dentroDoLimite(`lugar:${token}`, 30, 60))) return muitasTentativas();
  const lugar = await lugarGoogle(u.searchParams.get("id") ?? "", (u.searchParams.get("s") ?? "").slice(0, 64));
  return lugar ? Response.json(lugar) : Response.json({ erro: "Não foi possível localizar esse endereço. Confira o texto." }, { status: 502 });
}
