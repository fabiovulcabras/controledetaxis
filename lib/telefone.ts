/**
 * Telefones ficam guardados só com dígitos e DDI: 5511999998888.
 * O WhatsApp às vezes entrega números de celular do Brasil sem o nono dígito (55 11 99998888);
 * por isso a busca considera as duas formas.
 */
export const soDigitos = (t: string) => (t || "").replace(/\D/g, "");

/** Forma canônica: com DDI 55 e, para celulares brasileiros, com o nono dígito. */
export function normalizarTelefone(t: string): string {
  let d = soDigitos(t);
  if (d.length === 10 || d.length === 11) d = `55${d}`; // digitado sem DDI
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/** Formas possíveis do mesmo número, para buscar no cadastro. */
export function variantesTelefone(t: string): string[] {
  const canon = normalizarTelefone(t);
  const formas = new Set([canon, soDigitos(t)]);
  if (canon.startsWith("55") && canon.length === 13 && canon[4] === "9") formas.add(canon.slice(0, 4) + canon.slice(5));
  return [...formas].filter(Boolean);
}

/** "+55 (11) 99999-8888" */
export function formatarTelefone(t: string): string {
  const d = soDigitos(t);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : d ? `+${d}` : "";
}
