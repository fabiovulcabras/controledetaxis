"use client";
import { useEffect, useRef, useState } from "react";
import type { Sugestao } from "@/lib/endereco";

/** Unidade ou local cadastrado pelo planejamento (vem da API do pedido). */
export type LocalCadastrado = { nome: string; endereco: string; texto: string; lat: number | null; lng: number | null; tipo: "unidade" | "local"; minha: boolean };
type Opcao = { endereco: string; detalhe: string; lat: number | null; lng: number | null; titulo?: string; cadastrado?: boolean; placeId?: string };
/** Identificador da sessão de busca no Google (uma por endereço escolhido). */
const novaSessao = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Campo de endereço com sugestões enquanto digita. Ao escolher uma sugestão, devolve o texto e as coordenadas;
 * se a pessoa digitar livremente, as coordenadas voltam a null. Sugestões do Google (Places) trazem só o
 * identificador do lugar; o ponto é buscado ao escolher e marcado como do Google (não fica gravado na corrida).
 */
export default function CampoEndereco({ valor, onMudar, placeholder, perto, id, token, locais }: {
  valor: string; onMudar: (texto: string, lat: number | null, lng: number | null, google?: boolean) => void;
  placeholder?: string; perto?: { lat: number; lng: number } | null; id?: string; token: string; locais?: LocalCadastrado[];
}) {
  const [externas, setExternas] = useState<(Omit<Sugestao, "lat" | "lng"> & { lat: number | null; lng: number | null; placeId?: string })[]>([]);
  const [fonte, setFonte] = useState<"google" | "osm">("osm");
  const sessao = useRef(novaSessao());
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
      const params = new URLSearchParams({ q, t: token, s: sessao.current });
      if (perto) { params.set("lat", String(perto.lat)); params.set("lng", String(perto.lng)); }
      const r = await fetch(`/api/endereco/sugestoes?${params}`).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (n !== pedido.current) return; // chegou uma busca mais nova
      setBuscando(false);
      setExternas(j.sugestoes ?? []);
      setFonte(j.fonte === "google" ? "google" : "osm");
      setAtivo(-1);
    }, 400);
    return () => clearTimeout(t);
  }, [valor]);

  const escolher = async (s: Opcao) => {
    digitado.current = false;
    setAberto(false);
    if (!s.placeId) { onMudar(s.endereco, s.lat, s.lng); return; }
    // Sugestão do Google: busca o ponto exato do lugar (encerra a sessão de busca)
    onMudar(s.endereco, null, null);
    setBuscando(true);
    const params = new URLSearchParams({ t: token, id: s.placeId, s: sessao.current });
    const r = await fetch(`/api/endereco/lugar?${params}`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    setBuscando(false);
    sessao.current = novaSessao();
    if (j?.lat != null) onMudar(j.endereco || s.endereco, j.lat, j.lng, true);
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
          else if (e.key === "Enter" && ativo >= 0) { e.preventDefault(); void escolher(sugestoes[ativo]); }
          else if (e.key === "Escape") setAberto(false);
        }} />
      {buscando && valor.trim().length >= 3 && <span className="campo-endereco-busca">Buscando…</span>}
      {aberto && sugestoes.length > 0 && (
        <ul className="sugestoes" role="listbox">
          {sugestoes.map((s, i) => (
            <li key={`${s.cadastrado ? "c" : "e"}:${s.placeId ?? s.endereco}`} role="option" aria-selected={i === ativo} className={i === ativo ? "ativa" : ""}
              onMouseDown={(e) => { e.preventDefault(); void escolher(s); }}>
              {s.cadastrado ? <><strong>{s.titulo} <span className="tag-local">Cadastrado</span></strong><small>{s.detalhe}</small></>
                : <><strong>{s.endereco.split(",")[0]}</strong><small>{s.endereco.split(",").slice(1).join(",").trim() || s.detalhe}</small></>}
            </li>
          ))}
          {externas.length > 0 && <li className="sugestoes-fonte" aria-hidden="true">{fonte === "google" ? "powered by Google" : "Endereços: OpenStreetMap"}</li>}
        </ul>
      )}
    </div>
  );
}
