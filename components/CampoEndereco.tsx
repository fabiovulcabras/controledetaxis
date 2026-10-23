"use client";
import { useEffect, useRef, useState } from "react";
import type { Sugestao } from "@/lib/endereco";

/** Unidade ou local cadastrado pelo planejamento (vem da API do pedido). */
export type LocalCadastrado = { nome: string; endereco: string; texto: string; lat: number | null; lng: number | null; tipo: "unidade" | "local"; minha: boolean };
type Opcao = { endereco: string; detalhe: string; lat: number | null; lng: number | null; titulo?: string; cadastrado?: boolean };
const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Campo de endereço com sugestões enquanto digita. Ao escolher uma sugestão, devolve o texto e as coordenadas;
 * se a pessoa digitar livremente, as coordenadas voltam a null.
 */
export default function CampoEndereco({ valor, onMudar, placeholder, perto, id, token, locais }: {
  valor: string; onMudar: (texto: string, lat: number | null, lng: number | null) => void;
  placeholder?: string; perto?: { lat: number; lng: number } | null; id?: string; token: string; locais?: LocalCadastrado[];
}) {
  const [externas, setExternas] = useState<Sugestao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [buscando, setBuscando] = useState(false);
  // Só busca sugestões quando a mudança veio da digitação (atalhos e escolhas não abrem a lista)
  const digitado = useRef(false);
  const pedido = useRef(0);

  // Locais cadastrados que combinam com o que foi digitado aparecem primeiro, sem esperar a busca externa
  const q = normalizar(valor.trim());
  const cadastrados: Opcao[] = q.length >= 2 && digitado.current
    ? (locais ?? []).filter((l) => normalizar(`${l.nome} ${l.endereco}`).includes(q)).slice(0, 4)
      .map((l) => ({ endereco: l.texto, detalhe: l.endereco, lat: l.lat, lng: l.lng, titulo: l.nome, cadastrado: true }))
    : [];
  const sugestoes: Opcao[] = [...cadastrados, ...externas];

  useEffect(() => {
    if (!digitado.current) return;
    const q = valor.trim();
    setAberto(true);
    if (q.length < 3) { setExternas([]); return; }
    const t = setTimeout(async () => {
      const n = ++pedido.current;
      setBuscando(true);
      const params = new URLSearchParams({ q, t: token });
      if (perto) { params.set("lat", String(perto.lat)); params.set("lng", String(perto.lng)); }
      const r = await fetch(`/api/endereco/sugestoes?${params}`).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (n !== pedido.current) return; // chegou uma busca mais nova
      setBuscando(false);
      setExternas(j.sugestoes ?? []);
      setAtivo(-1);
    }, 400);
    return () => clearTimeout(t);
  }, [valor]);

  const escolher = (s: Opcao) => {
    digitado.current = false;
    onMudar(s.endereco, s.lat, s.lng);
    setAberto(false);
  };

  return (
    <div className="campo-endereco">
      <input id={id} value={valor} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={aberto && sugestoes.length > 0} aria-autocomplete="list"
        onChange={(e) => { digitado.current = true; onMudar(e.target.value, null, null); }}
        onFocus={() => sugestoes.length && setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (!aberto) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((a) => Math.min(a + 1, sugestoes.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && ativo >= 0) { e.preventDefault(); escolher(sugestoes[ativo]); }
          else if (e.key === "Escape") setAberto(false);
        }} />
      {buscando && valor.trim().length >= 3 && <span className="campo-endereco-busca">Buscando…</span>}
      {aberto && sugestoes.length > 0 && (
        <ul className="sugestoes" role="listbox">
          {sugestoes.map((s, i) => (
            <li key={`${s.cadastrado ? "c" : "e"}:${s.endereco}`} role="option" aria-selected={i === ativo} className={i === ativo ? "ativa" : ""}
              onMouseDown={(e) => { e.preventDefault(); escolher(s); }}>
              {s.cadastrado ? <><strong>{s.titulo} <span className="tag-local">Cadastrado</span></strong><small>{s.detalhe}</small></>
                : <><strong>{s.endereco.split(",")[0]}</strong><small>{s.endereco.split(",").slice(1).join(",").trim() || s.detalhe}</small></>}
            </li>
          ))}
          {externas.length > 0 && <li className="sugestoes-fonte" aria-hidden="true">Endereços: OpenStreetMap</li>}
        </ul>
      )}
    </div>
  );
}
