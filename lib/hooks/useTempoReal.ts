"use client";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Chama "aoMudar" quando alguma linha das tabelas muda no banco (Realtime do Supabase), agrupando
 * mudanças próximas em uma só chamada. Requer as tabelas na publicação supabase_realtime (migração 003).
 */
export function useTempoReal(tabelas: string[], aoMudar: () => void, ativo = true) {
  const ref = useRef(aoMudar);
  ref.current = aoMudar;
  const chave = tabelas.join(",");
  useEffect(() => {
    if (!ativo) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const disparar = () => { if (t) clearTimeout(t); t = setTimeout(() => ref.current(), 600); };
    const canal = supabase.channel(`tempo-real-${chave}-${Math.random().toString(36).slice(2)}`);
    for (const tabela of tabelas) canal.on("postgres_changes" as any, { event: "*", schema: "public", table: tabela }, disparar);
    canal.subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(canal); };
  }, [chave, ativo]);
}
