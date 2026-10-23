import "./globals.css";
import AuthGate from "@/components/AuthGate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Controle de Táxis",
  description: "Solicitação, acompanhamento e conciliação de corridas de táxi",
  icons: { icon: "/logo-v.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="brand-strip" aria-hidden="true" />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
