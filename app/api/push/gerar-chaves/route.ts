import { gerarChavesVapid } from "@/lib/webpush";

export const dynamic = "force-dynamic";

/**
 * Gera um par novo de chaves VAPID para configurar as notificações. Nada é gravado: copie os valores para as
 * variáveis da Vercel e faça redeploy. Cada acesso gera um par diferente.
 */
export async function GET() {
  const { publica, privada } = gerarChavesVapid();
  const texto = [
    "Copie para Vercel › Settings › Environment Variables e faça Redeploy:",
    "",
    `VAPID_PUBLIC_KEY=${publica}`,
    `VAPID_PRIVATE_KEY=${privada}`,
    "VAPID_SUBJECT=mailto:seu-email@empresa.com.br",
    "",
    "Guarde a chave privada como senha. Se trocar as chaves depois, as pessoas precisam ativar as notificações de novo.",
  ].join("\n");
  return new Response(texto, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
