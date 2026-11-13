import type { Metadata, Viewport } from "next";

/** Portal instalável do fornecedor (tela inicial do celular ou app no computador). */
export function generateMetadata({ params }: { params: { token: string } }): Metadata {
  return {
    title: "Portal do fornecedor",
    manifest: `/fornecedor/${params.token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Corridas", statusBarStyle: "default" },
    icons: { icon: "/logo-v.png", apple: "/logo-v.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0D2C54", width: "device-width", initialScale: 1 };

export default function LayoutPortal({ children }: { children: React.ReactNode }) {
  return children;
}
