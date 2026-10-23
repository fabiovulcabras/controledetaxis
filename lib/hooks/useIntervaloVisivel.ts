"use client";
import { useEffect, useRef } from "react";

/**
 * Executa "acao" a cada "ms" só enquanto a aba está visível, e uma vez assim que ela volta a aparecer.
 * Evita consultas ao banco com o celular bloqueado ou a aba em segundo plano.
 */
export function useIntervaloVisivel(acao: () => void, ms: number, ativo = true) {
  const ref = useRef(acao);
  ref.current = acao;
  useEffect(() => {
    if (!ativo) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const iniciar = () => { if (!t) t = setInterval(() => ref.current(), ms); };
    const parar = () => { if (t) { clearInterval(t); t = null; } };
    const aoMudar = () => { if (document.hidden) parar(); else { ref.current(); iniciar(); } };
    if (!document.hidden) iniciar();
    document.addEventListener("visibilitychange", aoMudar);
    return () => { parar(); document.removeEventListener("visibilitychange", aoMudar); };
  }, [ms, ativo]);
}
