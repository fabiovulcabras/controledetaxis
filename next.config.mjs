// Cabeçalhos de segurança de todas as páginas. As chamadas a Google, OpenRouteService, Evolution etc.
// saem do servidor; o navegador só fala com o próprio app e com o Supabase.
const supabase = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host; } catch { return ""; }
})();
const conectar = ["'self'", ...(supabase ? [`https://${supabase}`, `wss://${supabase}`] : ["https://*.supabase.co", "wss://*.supabase.co"])];
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // O Next.js injeta scripts em linha; em desenvolvimento usa eval para o recarregamento rápido
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src ${conectar.join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const cabecalhos = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Localização: o pedido usa para sugerir endereços perto; câmera e microfone não são usados
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecalhos }];
  },
};
