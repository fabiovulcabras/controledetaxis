"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Tipo = "solicitante" | "fornecedor" | "planejamento";
type Estado = "carregando" | "sem_suporte" | "instalar_iphone" | "bloqueado" | "desligado" | "ligado" | "sem_config";

const paraBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

/**
 * Botão para ativar as notificações push neste aparelho (celular ou computador).
 * Solicitante e fornecedor usam o token do link; o planejamento usa o login do painel.
 */
export default function NotificacoesPush({ tipo, token, compacto }: { tipo: Tipo; token?: string; compacto?: boolean }) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const registro = async () => (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado(ehIphone() && !instalado() ? "instalar_iphone" : "sem_suporte");
        return;
      }
      if (Notification.permission === "denied") { setEstado("bloqueado"); return; }
      const reg = await registro();
      const insc = await reg.pushManager.getSubscription();
      setEstado(insc && Notification.permission === "granted" ? "ligado" : "desligado");
    })().catch(() => setEstado("sem_suporte"));
  }, []);

  const cabecalhos = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (tipo === "planejamento") {
      const { data } = await supabase.auth.getSession();
      if (data.session) h.Authorization = `Bearer ${data.session.access_token}`;
    }
    return h;
  };

  const ativar = async () => {
    setOcupado(true); setMsg("");
    try {
      const chave = await fetch("/api/push/chave").then((r) => r.json());
      if (!chave.publica) { setEstado("sem_config"); setMsg(chave.erro ?? ""); return; }
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") { setEstado(permissao === "denied" ? "bloqueado" : "desligado"); return; }
      const reg = await registro();
      await navigator.serviceWorker.ready;
      let insc = await reg.pushManager.getSubscription();
      if (!insc) insc = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chave.publica) });
      const r = await fetch("/api/push/inscrever", { method: "POST", headers: await cabecalhos(), body: JSON.stringify({ inscricao: insc.toJSON(), tipo, token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.erro ?? "Não foi possível ativar."); return; }
      setEstado("ligado"); setMsg("Notificações ativadas neste aparelho.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível ativar.");
    } finally { setOcupado(false); }
  };

  const desativar = async () => {
    setOcupado(true); setMsg("");
    try {
      const insc = await (await registro()).pushManager.getSubscription();
      if (insc) {
        await fetch("/api/push/sair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: insc.endpoint }) });
        await insc.unsubscribe();
      }
      setEstado("desligado"); setMsg("Notificações desativadas neste aparelho.");
    } finally { setOcupado(false); }
  };

  const testar = async () => {
    setOcupado(true); setMsg("");
    try {
      const insc = await (await registro()).pushManager.getSubscription();
      const r = await fetch("/api/push/teste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: insc?.endpoint, url: location.pathname }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "Enviamos uma notificação de teste." : j.erro ?? "Não foi possível enviar o teste.");
    } finally { setOcupado(false); }
  };

  if (estado === "carregando" || estado === "sem_config" && !msg) return null;
  const texto = {
    sem_suporte: "Este navegador não recebe notificações. No celular, use o Chrome (Android) ou o Safari (iPhone).",
    instalar_iphone: "No iPhone, as notificações funcionam com o app na tela inicial: toque em Compartilhar › Adicionar à Tela de Início e abra pelo ícone.",
    bloqueado: "As notificações estão bloqueadas para este site. Libere em Configurações do navegador › Notificações e recarregue a página.",
    desligado: tipo === "planejamento" ? "Receba os alertas das corridas mesmo com o painel fechado." : "Receba o andamento das corridas no celular, mesmo com esta página fechada.",
    ligado: "Notificações ativas neste aparelho.",
    sem_config: msg,
    carregando: "",
  }[estado];

  return (
    <div className={compacto ? "push-caixa compacto" : "push-caixa"}>
      <span>{texto}</span>
      <div className="row">
        {estado === "desligado" && <button type="button" className="pri" disabled={ocupado} onClick={ativar}>{ocupado ? "Ativando…" : "Ativar notificações"}</button>}
        {estado === "ligado" && <>
          <button type="button" className="ghost" disabled={ocupado} onClick={testar}>Enviar teste</button>
          <button type="button" className="ghost" disabled={ocupado} onClick={desativar}>Desativar</button>
        </>}
      </div>
      {msg && estado !== "sem_config" && <small className="texto-fraco">{msg}</small>}
    </div>
  );
}
