import type { SupabaseClient } from "@supabase/supabase-js";
import { linkRoteiro, pontosDePassagem, rotaCompleta } from "./distancia";
import { pontosDaCorrida } from "./km-corrida";

type Corr = Parameters<typeof pontosDaCorrida>[1] & { protocolo: string };
export type Roteiro = { km: number; link: string; passagens: number; texto: string };

/** Mensagem do roteiro ao fornecedor (separada para teste). */
export function textoRoteiro(c: { protocolo: string; origem: string; destino: string }, _km: number, link: string, _passagens: number): string {
  return [
    `🗺️ Roteiro da corrida ${c.protocolo}`,
    `Origem: ${c.origem}`,
    `Destino: ${c.destino}`,
    `Abra no Google Maps: ${link}`,
  ].join("\n");
}

/**
 * Roteiro do menor trajeto da corrida: km e link do Google Maps com pontos de passagem que mantêm o caminho.
 * Null se não der para localizar origem e destino. Nada fica gravado (só calcula na hora).
 */
export async function roteiroDaCorrida(db: SupabaseClient, c: Corr): Promise<Roteiro | null> {
  const pts = await pontosDaCorrida(db, c).catch(() => null);
  if (!pts) return null;
  const rota = await rotaCompleta(pts.o.p, pts.d.p);
  const passagem = pontosDePassagem(rota.caminho);
  const link = linkRoteiro(pts.o.p, pts.d.p, passagem);
  return { km: rota.km, link, passagens: passagem.length, texto: textoRoteiro(c, rota.km, link, passagem.length) };
}
