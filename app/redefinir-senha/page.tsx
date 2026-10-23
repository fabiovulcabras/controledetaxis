"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";

export default function RedefinirSenha() {
  const [validando, setValidando] = useState(true);
  const [sessaoValida, setSessaoValida] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let ativo = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (ativo && sessao && (evento === "PASSWORD_RECOVERY" || evento === "SIGNED_IN")) {
        setSessaoValida(true);
        setValidando(false);
      }
    });
    supabase.auth.getSession().then(({ data, error: erroSessao }) => {
      if (!ativo) return;
      setSessaoValida(Boolean(data.session));
      setValidando(false);
      if (erroSessao) setErro("Não foi possível validar o link de recuperação.");
    });
    return () => { ativo = false; subscription.unsubscribe(); };
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro("");
    if (senha.length < 8) { setErro("A senha deve ter pelo menos 8 caracteres."); return; }
    if (senha !== confirmacao) { setErro("As senhas não coincidem."); return; }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setErro("Não foi possível atualizar a senha. Solicite um novo link e tente novamente.");
      setSalvando(false);
      return;
    }
    router.replace("/");
  };

  return (
    <main className="auth-screen">
      <form className="login card" onSubmit={salvar}>
        <div className="login-brand"><BrandMark /></div>
        <h2>Criar nova senha</h2>
        {validando && <p>Validando o link de recuperação...</p>}
        {!validando && !sessaoValida && <>
          <p className="err">Este link é inválido ou expirou. Solicite uma nova recuperação de senha.</p>
          <Link href="/" className="ghost">Voltar ao login</Link>
        </>}
        {!validando && sessaoValida && <>
          <label>Nova senha<input type="password" required minLength={8} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
          <label>Confirmar nova senha<input type="password" required minLength={8} autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
          {erro && <div className="err">{erro}</div>}
          <button className="pri" disabled={salvando}>{salvando ? "Salvando..." : "Salvar nova senha"}</button>
        </>}
      </form>
    </main>
  );
}
