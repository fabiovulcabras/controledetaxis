export const dynamic = "force-dynamic";

/** Manifesto do app instalável, um por pessoa: o ícone abre o link pessoal de pedido. */
export function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = /^[0-9a-f]{64}$/.test(params.token) ? params.token : "";
  return Response.json({
    name: "Pedido de táxi",
    short_name: "Táxi",
    start_url: `/pedir/${token}`,
    scope: `/pedir/${token}`,
    display: "standalone",
    background_color: "#F1F5F9",
    theme_color: "#0D2C54",
    icons: [{ src: "/logo-v.png", sizes: "200x200", type: "image/png", purpose: "any" }],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600" } });
}
