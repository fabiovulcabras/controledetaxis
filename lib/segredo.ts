import { createHash, timingSafeEqual } from "node:crypto";

/** Compara um segredo recebido com o configurado em tempo constante (não revela quantos caracteres acertou). */
export function segredoConfere(recebido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recebido || !esperado) return false;
  const a = createHash("sha256").update(recebido).digest(), b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
