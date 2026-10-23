import type { Metadata, Viewport } from "next";

/** Ao salvar o link na tela inicial, o celular mostra o ícone "Táxi" e abre direto o pedido desta pessoa. */
export function generateMetadata({ params }: { params: { token: string } }): Metadata {
  return {
    title: "Pedir táxi",
    manifest: `/pedir/${params.token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Táxi", statusBarStyle: "default" },
    icons: { icon: "/logo-v.png", apple: "/logo-v.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0D2C54", width: "device-width", initialScale: 1 };

export default function LayoutPedido({ children }: { children: React.ReactNode }) {
  return children;
}
