"use client";
import { useState } from "react";
import { Campo } from "@/components/Formulario";

/** Login do portal do fornecedor: e-mail cadastrado + código de acesso de 6 dígitos (a senha). */
export default function LoginFornecedor({ token, onEntrou }: { token?: string; onEntrou: (tokenPortal: string) => void }) {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(""); setOcupado(true);
    try {
      const r = await fetch("/api/portal/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token ?? null, email, codigo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro ?? "Não foi possível entrar."); return; }
      onEntrou(j.token);
    } finally { setOcupado(false); }
  };
  return (
    <form className="card" onSubmit={entrar} style={{ maxWidth: 420, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Entrar no portal</h2>
      <p className="pagina-sub">Use o e-mail cadastrado no planejamento. A senha é o seu <strong>código de acesso</strong> de 6 números. Basta entrar uma vez neste aparelho.</p>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <Campo rotulo="E-mail"><input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" required /></Campo>
        <Campo rotulo="Senha (código de acesso)"><input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} placeholder="••••••" required /></Campo>
        {erro && <p className="err" style={{ margin: 0 }}>{erro}</p>}
        <button className="pri botao-grande" disabled={ocupado || !email.includes("@") || codigo.length !== 6}>{ocupado ? "Conferindo…" : "Entrar"}</button>
      </div>
      <p className="texto-fraco" style={{ marginTop: 12, fontSize: 13 }}>Esqueceu o código ou o e-mail? Fale com o planejamento.</p>
    </form>
  );
}
