"use client";
import { useEffect, useState } from "react";

/** "responde em 6 min" / "atrasada 3 min", atualizado a cada 30 s. */
export default function Prazo({ ate, compacto }: { ate: string | null | undefined; compacto?: boolean }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!ate) return null;
  const min = Math.round((new Date(ate).getTime() - agora) / 60_000);
  const texto = min >= 0
    ? (min >= 120 ? `responde até ${new Date(ate).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : `responde em ${min} min`)
    : `atrasada ${-min} min`;
  return <span className={`prazo ${min < 0 ? "prazo-atrasado" : min <= 3 ? "prazo-perto" : ""}${compacto ? " prazo-compacto" : ""}`}>{texto}</span>;
}
