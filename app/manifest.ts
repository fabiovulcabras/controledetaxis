import type { MetadataRoute } from "next";

/** Painel instalável (Chrome › Instalar app): o planejamento recebe os alertas mesmo com o painel fechado. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Controle de Táxis",
    short_name: "Táxis",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F1F5F9",
    theme_color: "#0D2C54",
    icons: [{ src: "/logo-v.png", sizes: "200x200", type: "image/png", purpose: "any" }],
  };
}
