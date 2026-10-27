/**
 * Resposta média em minutos inteiros: abaixo de 1 minuto arredonda para cima (1);
 * de 1 minuto em diante, para o inteiro mais próximo (1,4 → 1; 1,5 → 2; 12,6 → 13).
 */
export function minutosInteiros(min: number | null | undefined): number | null {
  if (min == null || !Number.isFinite(Number(min))) return null;
  const v = Number(min);
  if (v <= 0) return 0;
  return v < 1 ? 1 : Math.round(v);
}

/** Taxa de aceite por viagem: aceitas / viagens com resultado (aceita, recusada ou sem resposta), em % inteiro. */
export function taxaAceite(aceitas: number, decididas: number): number | null {
  return decididas > 0 ? Math.round((aceitas / decididas) * 100) : null;
}
