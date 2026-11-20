import type { SupabaseClient } from "@supabase/supabase-js";
import { linkRoteiro, pontosDePassagem, rotaCompleta, rotaEntre } from "./distancia";
import { pontosDaCorrida } from "./km-corrida";
import { paradasDa } from "./multidestino";

type Corr = Parameters<typeof pontosDaCorrida>[1] & { protocolo: string };
export type Roteiro = { km: number; link: string; passagens: number; texto: string };

/** Mensagem do roteiro ao fornecedor (separada para teste). Com paradas, lista na ordem a seguir. */
export function textoRoteiro(c: { protocolo: string; origem: string; destino: string; paradas?: unknown }, _km: number, link: string, _passagens: number): string {
  const paradas = paradasDa(c);
  return [
    `🗺️ Roteiro da corrida ${c.protocolo}`,
    `Origem: ${c.origem}`,
    ...paradas.map((p, i) => `Parada ${i + 1}: ${p.texto}`),
    `${paradas.length ? "Destino final" : "Destino"}: ${c.destino}`,
    `Abra no Google Maps: ${link}`,
  ].join("\n");
}

/**
 * Roteiro do menor trajeto da corrida: km e link do Google Maps. Sem paradas, o link leva pontos de passagem
 * que mantêm o caminho mais curto; com paradas, as paradas são os pontos do link, na ordem do menor km.
 * Null se não der para localizar os endereços. Nada fica gravado (só calcula na hora).
 */
export async function roteiroDaCorrida(db: SupabaseClient, c: Corr): Promise<Roteiro | null> {
  const pts = await pontosDaCorrida(db, c).catch(() => null);
  if (!pts) return null;
  if (pts.paradas.length) {
    const seq = [pts.o, ...pts.paradas, pts.d];
    const pernas = await Promise.all(seq.slice(1).map((p, i) => rotaEntre(seq[i].p, p.p)));
    const km = Math.round(pernas.reduce((s, r) => s + r.km, 0) * 100) / 100;
    const link = linkRoteiro(pts.o.p, pts.d.p, pts.paradas.map((x) => x.p));
    return { km, link, passagens: 0, texto: textoRoteiro(c, km, link, 0) };
  }
  const rota = await rotaCompleta(pts.o.p, pts.d.p);
  const passagem = pontosDePassagem(rota.caminho);
  const link = linkRoteiro(pts.o.p, pts.d.p, passagem);
  return { km: rota.km, link, passagens: passagem.length, texto: textoRoteiro(c, rota.km, link, passagem.length) };
}
