"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import Sidebar from "@/components/Sidebar";
import { Button, Input, PageHeader } from "@/components/UI";

export type Profile = { id: string; nome: string; perfil: "admin" | "planejamento" | "consulta"; ativo?: boolean };
export type NivelMenu = "todos" | "planejamento" | "admin";
type Ctx = { profile: Profile; planejamento: boolean; admin: boolean };
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const NAV: [string, string, NivelMenu][] = [
  ["/", "Visão geral", "todos"],
  ["/corridas", "Corridas", "todos"],
  ["/conciliacao", "Conciliação", "planejamento"],
  ["/simulador", "Simulador do bot", "planejamento"],
  ["/cadastros", "Cadastros", "admin"],
];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let ativo = true;
    if (!session) { setProfile(null); setProfileError(""); setProfileLoading(false); return () => { ativo = false; }; }
    setProfileLoading(true);
    setProfileError("");
    (async () => {
      const { data: p, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (!ativo) return;
      if (error || !p) {
        setProfile(null);
        setProfileError(error?.code === "PGRST116"
          ? "Sua conta entrou, mas ainda não tem um perfil no sistema. Peça à administração para liberar o acesso."
          : `Não foi possível carregar seu perfil: ${error?.message ?? "registro não encontrado"}`);
      } else if (p.ativo === false) {
        setProfile(null);
        setProfileError("Seu acesso está desativado. Procure a administração.");
      } else {
        setProfile(p);
      }
      setProfileLoading(false);
    })();
    return () => { ativo = false; };
  }, [session, profileAttempt]);

  useEffect(() => { setMenuOpen(false); }, [path]);

  if (!supabaseConfigurado) return <main className="main"><section className="card">
    <h2>Configuração incompleta</h2>
    <p className="err">Este ambiente não tem as variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY. Cadastre-as na Vercel (Settings → Environment Variables) e faça um novo deploy.</p>
  </section></main>;
  // Páginas abertas por link (pedido da pessoa autorizada e resposta do fornecedor) não pedem login
  if (path === "/redefinir-senha" || path.startsWith("/pedir/") || path.startsWith("/f/")) return children;
  if (session === undefined) return null;
  if (!session) return <Login />;
  if (!profile) return <main className="main"><section className="card">
    <h2>{profileLoading ? "Carregando acesso…" : "Não foi possível carregar seu acesso"}</h2>
    {profileError && <p className="err">{profileError}</p>}
    {!profileLoading && <div className="row">
      <button type="button" className="ghost" onClick={() => setProfileAttempt((t) => t + 1)}>Tentar novamente</button>
      <button type="button" onClick={() => supabase.auth.signOut()}>Sair</button>
    </div>}
  </section></main>;

  const admin = profile.perfil === "admin";
  const planejamento = admin || profile.perfil === "planejamento";
  const permitido = NAV.find(([href]) => (href === "/" ? path === "/" : path.startsWith(href)));
  const bloqueado = permitido && ((permitido[2] === "planejamento" && !planejamento) || (permitido[2] === "admin" && !admin));

  return (
    <AppCtx.Provider value={{ profile, planejamento, admin }}>
      <div className="shell">
        <header className="mobile-header">
          <button type="button" className="menu-toggle" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <span /><span /><span />
          </button>
          <BrandMark />
          <strong>Controle de Táxis</strong>
        </header>
        <Sidebar path={path} nav={NAV} planejamento={planejamento} admin={admin} profileName={profile.nome}
          onSignOut={() => { void supabase.auth.signOut(); }} open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="main">{bloqueado ? <p className="empty">Seu perfil não tem acesso a esta tela.</p> : children}</main>
      </div>
    </AppCtx.Provider>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setInfo(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) setErr("E-mail ou senha incorretos.");
    setBusy(false);
  };
  const esqueciSenha = async () => {
    setErr(""); setInfo("");
    if (!email.trim()) { setErr("Informe seu e-mail para receber o link de recuperação."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/redefinir-senha` });
    setBusy(false);
    if (error) setErr("Não foi possível enviar o e-mail de recuperação. Tente novamente mais tarde.");
    else setInfo("Se o endereço estiver cadastrado, você receberá um link para criar uma nova senha.");
  };
  return (
    <main className="auth-screen">
      <form className="login card" onSubmit={entrar}>
        <div className="login-brand"><BrandMark /></div>
        <PageHeader title="Entrar no controle de táxis" />
        <label>E-mail<Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Senha<Input type="password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        {info && <div className="ok">{info}</div>}
        <Button variant="primary" disabled={busy}>{busy ? "Aguarde..." : "Entrar"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={esqueciSenha}>Esqueci minha senha</Button>
        <p className="empty">Acesso fornecido pela administração.</p>
      </form>
    </main>
  );
}
