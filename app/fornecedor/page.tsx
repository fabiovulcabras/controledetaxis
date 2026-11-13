"use client";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import LoginFornecedor from "@/components/LoginFornecedor";

/** Entrada do portal sem o link: o e-mail encontra o portal do fornecedor. */
export default function EntrarPortal() {
  const router = useRouter();
  return (
    <div className="publico">
      <header className="publico-topo"><div className="conteudo"><BrandMark /><div><strong>Portal do fornecedor</strong></div></div></header>
      <main className="publico-corpo">
        <LoginFornecedor onEntrou={(t) => router.replace(`/fornecedor/${t}`)} />
      </main>
    </div>
  );
}
