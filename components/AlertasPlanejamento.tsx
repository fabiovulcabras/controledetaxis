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
/** Outras pendências do planejamento (fora das exceções de corrida). Sem as migrações 015/021, ficam em zero. */
export type Pendencias = { extras: number; contestados: number; espelhosVencendo: number; notasBaixas: number };
type Ctx = { excecoes: number; pendencias: Pendencias; permissao: string; pedirPermissao: () => Promise<void> };
const SEM_PENDENCIAS: Pendencias = { extras: 0, contestados: 0, espelhosVencendo: 0, notasBaixas: 0 };
const AlertasCtx = createContext<Ctx>({ excecoes: 0, pendencias: SEM_PENDENCIAS, permissao: "default", pedirPermissao: async () => {} });
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
  const [pendencias, setPendencias] = useState<Pendencias>(SEM_PENDENCIAS);
  const [permissao, setPermissao] = useState("default");
  const anterior = useRef<number | null>(null);

  const contar = useCallback(async () => {
    if (!ativo) return;
    const amanha = new Date(Date.now() + 24 * 3600_000).toISOString();
    const semana = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const conta = (q: PromiseLike<{ count: number | null; error: unknown }>) => Promise.resolve(q).then((r) => (r.error ? 0 : r.count ?? 0), () => 0);
    const [count, extras, contestados, vencendo, notas] = await Promise.all([
      conta(supabase.from("corridas").select("id", { count: "exact", head: true }).in("status", EXCECOES)),
      conta(supabase.from("corrida_extras").select("id", { count: "exact", head: true }).eq("status", "pendente")),
      conta(supabase.from("espelhos").select("id", { count: "exact", head: true }).eq("status", "contestado")),
      conta(supabase.from("espelhos").select("id", { count: "exact", head: true }).eq("status", "aguardando").lte("prazo_em", amanha)),
      conta(supabase.from("corridas").select("id", { count: "exact", head: true }).lte("avaliacao", 2).gte("avaliada_em", semana)),
    ]);
    setPendencias({ extras, contestados, espelhosVencendo: vencendo, notasBaixas: notas });
    const n = count + extras + contestados;
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
  // Extras e espelhos não estão no tempo real: entram na contagem periódica
  useIntervaloVisivel(() => void contar(), 60_000, ativo);

  const pedirPermissao = async () => {
    if (typeof Notification === "undefined") { setPermissao("indisponivel"); return; }
    setPermissao(await Notification.requestPermission());
  };

  return <AlertasCtx.Provider value={{ excecoes, pendencias, permissao, pedirPermissao }}>{children}</AlertasCtx.Provider>;
}
