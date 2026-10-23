"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useTempoReal } from "@/lib/hooks/useTempoReal";
import { useIntervaloVisivel } from "@/lib/hooks/useIntervaloVisivel";
import { EXCECOES } from "@/lib/status";

/**
 * Para o planejamento: conta as exceções abertas e avisa (som e notificação do navegador) quando surge uma nova.
 * Funciona sem a API do WhatsApp; basta o painel estar aberto em alguma aba.
 */
type Ctx = { excecoes: number; permissao: string; pedirPermissao: () => Promise<void> };
const AlertasCtx = createContext<Ctx>({ excecoes: 0, permissao: "default", pedirPermissao: async () => {} });
export const useAlertas = () => useContext(AlertasCtx);

function bip() {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    [0, 0.22].forEach((atraso) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + atraso); o.stop(ctx.currentTime + atraso + 0.15);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch { /* sem áudio */ }
}

export function AlertasProvider({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  const [excecoes, setExcecoes] = useState(0);
  const [permissao, setPermissao] = useState("default");
  const anterior = useRef<number | null>(null);

  const contar = useCallback(async () => {
    if (!ativo) return;
    const { count } = await supabase.from("corridas").select("id", { count: "exact", head: true }).in("status", EXCECOES);
    const n = count ?? 0;
    if (anterior.current != null && n > anterior.current) {
      bip();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Controle de Táxis", { body: `${n - anterior.current} nova(s) exceção(ões) para tratar.`, icon: "/logo-v.png", tag: "excecoes" });
      }
    }
    anterior.current = n;
    setExcecoes(n);
  }, [ativo]);

  useEffect(() => {
    void contar();
    if (typeof Notification !== "undefined") setPermissao(Notification.permission);
  }, [contar]);
  useTempoReal(["corridas"], () => void contar(), ativo);
  useIntervaloVisivel(() => void contar(), 60_000, ativo);

  const pedirPermissao = async () => {
    if (typeof Notification === "undefined") { setPermissao("indisponivel"); return; }
    setPermissao(await Notification.requestPermission());
  };

  return <AlertasCtx.Provider value={{ excecoes, permissao, pedirPermissao }}>{children}</AlertasCtx.Provider>;
}
