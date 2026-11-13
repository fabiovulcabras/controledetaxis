export const dynamic = "force-dynamic";

/** Manifesto do portal do fornecedor: instalado, o ícone abre o portal e as notificações abrem as corridas no app. */
export function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = /^[0-9a-f]{64}$/.test(params.token) ? params.token : "";
  return Response.json({
    name: "Corridas de táxi — fornecedor",
    short_name: "Corridas",
    start_url: `/fornecedor/${token}`,
    scope: "/",
    display: "standalone",
    background_color: "#F1F5F9",
    theme_color: "#0D2C54",
    icons: [{ src: "/logo-v.png", sizes: "200x200", type: "image/png", purpose: "any" }],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600" } });
}
