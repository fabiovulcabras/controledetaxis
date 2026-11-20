// Corrida com vários destinos: o destino mais longe da origem é o final; as outras paradas
// entram na ordem que dá o menor km rodado. O preço de tabela é o do destino final, e o km
// rodado (origem → paradas → destino final) é a base do cálculo por km.

/** Parada intermediária guardada na corrida (coordenadas só quando não vieram do Google). */
export type Parada = { texto: string; lat: number | null; lng: number | null };
/** No máximo 5 destinos por corrida: o final e até 4 paradas. */
export const MAX_DESTINOS = 5;

/**
 * Ordem dos destinos. `daOrigem[i]`: km da origem até o destino i; `entre[i][j]`: km do destino i ao j.
 * O final é o mais longe da origem; as paradas são ordenadas para o menor km total (testa todas as ordens:
 * com até 4 paradas são no máximo 24). Devolve a ordem (índices, terminando no final) e o km total.
 */
export function ordenarDestinos(daOrigem: number[], entre: number[][]): { ordem: number[]; final: number; km: number } {
  const n = daOrigem.length;
  if (!n) return { ordem: [], final: -1, km: 0 };
  const final = daOrigem.reduce((m, v, i) => (v > daOrigem[m] ? i : m), 0);
  const paradas = [...Array(n).keys()].filter((i) => i !== final);
  let melhor: number[] = paradas, melhorKm = Infinity;
  for (const perm of permutacoes(paradas)) {
    const seq = [...perm, final];
    let km = daOrigem[seq[0]];
    for (let k = 1; k < seq.length; k++) km += entre[seq[k - 1]][seq[k]];
    if (km < melhorKm - 1e-9) { melhorKm = km; melhor = perm; }
  }
  return { ordem: [...melhor, final], final, km: Math.round(melhorKm * 100) / 100 };
}

function* permutacoes<T>(itens: T[]): Generator<T[]> {
  if (itens.length <= 1) { yield [...itens]; return; }
  for (let i = 0; i < itens.length; i++) {
    const resto = [...itens.slice(0, i), ...itens.slice(i + 1)];
    for (const p of permutacoes(resto)) yield [itens[i], ...p];
  }
}

/** Lê as paradas gravadas (jsonb), ignorando o que não for uma parada válida. */
export function paradasDa(c: object): Parada[] {
  const lista = (c as { paradas?: unknown }).paradas;
  return Array.isArray(lista)
    ? lista.filter((p: any) => p && typeof p.texto === "string" && p.texto.trim())
        .map((p: any) => ({ texto: String(p.texto), lat: Number.isFinite(p.lat) ? p.lat : null, lng: Number.isFinite(p.lng) ? p.lng : null }))
    : [];
}

/** "Parada 1 → Parada 2 → Destino final", ou só o destino quando não há paradas. */
export function trajetoTexto(c: { destino: string }): string {
  const p = paradasDa(c);
  return p.length ? [...p.map((x) => x.texto), c.destino].join(" → ") : c.destino;
}
