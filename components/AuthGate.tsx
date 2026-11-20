"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";
import Sidebar from "@/components/Sidebar";
import { Button, Input, PageHeader } from "@/components/UI";
import { RetornoProvider } from "@/components/Retorno";
import { AlertasProvider } from "@/components/AlertasPlanejamento";

export type Profile = { id: string; nome: string; perfil: "admin" | "planejamento" | "consulta"; ativo?: boolean };
export type NivelMenu = "todos" | "planejamento" | "admin";
type Ctx = { profile: Profile; planejamento: boolean; admin: boolean };
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const NAV: [string, string, NivelMenu][] = [
  ["/", "Visão geral", "todos"],
  ["/corridas", "Corridas", "todos"],
  ["/relatorios", "Relatórios", "todos"],
  ["/conciliacao", "Conciliação", "planejamento"],
  ["/portais", "Portais dos fornecedores", "planejamento"],
  ["/cadastros", "Cadastros", "admin"],
];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // 2 fatores (parâmetro mfa_obrigatorio): admin e planejamento confirmam com o código do aplicativo autenticador
  const [mfa, setMfa] = useState<"ok" | "desafio" | "cadastro" | null>(null);
  useEffect(() => {
    let ativo = true;
    (async () => {
      if (!profile) { setMfa(null); return; }
      if (profile.perfil === "consulta") { setMfa("ok"); return; }
      const { data: p } = await supabase.from("parametros").select("valor").eq("chave", "mfa_obrigatorio").maybeSingle();
      if (String(p?.valor ?? "").trim().toLowerCase() !== "sim") { if (ativo) setMfa("ok"); return; }
      const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (nivel?.currentLevel === "aal2") { if (ativo) setMfa("ok"); return; }
      const { data: fatores } = await supabase.auth.mfa.listFactors();
      if (ativo) setMfa(fatores?.totp?.some((f) => f.status === "verified") ? "desafio" : "cadastro");
    })().catch(() => { if (ativo) setMfa("ok"); });
    return () => { ativo = false; };
  }, [profile, session]);
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
  if (path === "/redefinir-senha" || path.startsWith("/pedir/") || path.startsWith("/f/") || path === "/fornecedor" || path.startsWith("/fornecedor/")) return children;
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

  if (mfa === null) return <main className="main"><p className="empty">Carregando acesso…</p></main>;
  if (mfa !== "ok") return <SegundoFator modo={mfa} onSair={() => void supabase.auth.signOut()} />;

  const admin = profile.perfil === "admin";
  const planejamento = admin || profile.perfil === "planejamento";
  const permitido = NAV.find(([href]) => (href === "/" ? path === "/" : path.startsWith(href)));
  const bloqueado = permitido && ((permitido[2] === "planejamento" && !planejamento) || (permitido[2] === "admin" && !admin));

  return (
    <AppCtx.Provider value={{ profile, planejamento, admin }}>
     <RetornoProvider>
     <AlertasProvider ativo={planejamento}>
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
     </AlertasProvider>
     </RetornoProvider>
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

/** Cadastro do aplicativo autenticador (QR code) ou confirmação do código de 6 dígitos. */
function SegundoFator({ modo, onSair }: { modo: "desafio" | "cadastro"; onSair: () => void }) {
  const [fator, setFator] = useState<{ id: string; qr?: string; segredo?: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: lista } = await supabase.auth.mfa.listFactors();
      if (modo === "desafio") {
        const f = lista?.totp?.find((x) => x.status === "verified");
        if (f) setFator({ id: f.id });
        return;
      }
      // Tentativas anteriores não confirmadas atrapalham um novo cadastro
      for (const f of (lista?.all ?? []).filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Controle de Táxis ${new Date().toISOString().slice(0, 10)}` });
      if (error || !data) { setErr(`Não foi possível iniciar o cadastro: ${error?.message ?? "sem resposta"}. Confira se o MFA (TOTP) está ligado no Supabase (Authentication › Multi-Factor).`); return; }
      setFator({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
    })();
  }, [modo]);
  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!fator) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo.replace(/\D/g, "") });
    setBusy(false);
    if (error) setErr("Código incorreto ou expirado. Confira o horário do celular e tente o código atual.");
  };
  return (
    <main className="auth-screen">
      <form className="login card" onSubmit={confirmar}>
        <div className="login-brand"><BrandMark /></div>
        <PageHeader title={modo === "cadastro" ? "Ative a verificação em 2 etapas" : "Verificação em 2 etapas"} />
        {modo === "cadastro" ? (
          <p className="empty" style={{ textAlign: "left" }}>Para usar o painel, instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar), leia o QR code e digite o código de 6 números.</p>
        ) : <p className="empty" style={{ textAlign: "left" }}>Digite o código de 6 números do seu aplicativo autenticador.</p>}
        {fator?.qr && <img src={fator.qr} alt="QR code para o aplicativo autenticador" width={180} height={180} style={{ margin: "0 auto", background: "#fff", padding: 8, borderRadius: 8 }} />}
        {fator?.segredo && <small className="texto-fraco" style={{ wordBreak: "break-all" }}>Sem câmera? Digite a chave: <strong>{fator.segredo}</strong></small>}
        <label>Código<Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus /></label>
        {err && <div className="err">{err}</div>}
        <Button variant="primary" disabled={busy || !fator || codigo.replace(/\D/g, "").length !== 6}>{busy ? "Conferindo…" : "Confirmar"}</Button>
        <Button type="button" variant="secondary" onClick={onSair}>Sair</Button>
      </form>
    </main>
  );
}
