"use client";
import { useEffect, type ReactNode } from "react";

/** Painel lateral de cadastro/edição. Fecha com Esc ou clicando fora, exceto durante o salvamento. */
export function PainelLateral({ titulo, subtitulo, onFechar, ocupado = false, largura, children }: {
  titulo: string; subtitulo?: ReactNode; onFechar: () => void; ocupado?: boolean; largura?: number; children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ocupado, onFechar]);
  return (
    <>
      <button type="button" className="painel-fundo" aria-label="Fechar" onClick={() => !ocupado && onFechar()} />
      <aside className="painel-lateral" role="dialog" aria-modal="true" aria-label={titulo} style={largura ? { width: `min(${largura}px, 100vw)` } : undefined}>
        <header className="painel-cabecalho">
          <div>
            <h2>{titulo}</h2>
            {subtitulo && <p className="pagina-sub">{subtitulo}</p>}
          </div>
          <button type="button" className="ghost" onClick={onFechar} disabled={ocupado} aria-label="Fechar">✕</button>
        </header>
        {children}
      </aside>
    </>
  );
}

/**
 * Grupo de formulário para conteúdos com botões (escolhas, atalhos, listas de sugestão).
 * Usa <div> no lugar de <label>: tocar num botão dentro de um label refoca o campo e reabre o teclado no celular.
 */
export function GrupoCampo({ rotulo, obrigatorio, ajuda, htmlFor, children }: {
  rotulo: ReactNode; obrigatorio?: boolean; ajuda?: ReactNode; htmlFor?: string; children: ReactNode;
}) {
  return (
    <div className="grupo-campo campo" role="group">
      {htmlFor ? <label htmlFor={htmlFor} className="campo-rotulo">{rotulo}{obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}</label>
        : <span className="campo-rotulo">{rotulo}{obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}</span>}
      {children}
      {ajuda && <div className="campo-ajuda">{ajuda}</div>}
    </div>
  );
}

/** Campo de formulário com rótulo, obrigatoriedade e uma linha de ajuda, aviso ou erro. */
export function Campo({ rotulo, obrigatorio, erro, aviso, ajuda, largo, children }: {
  rotulo: ReactNode; obrigatorio?: boolean; erro?: string; aviso?: string; ajuda?: ReactNode; largo?: boolean; children: ReactNode;
}) {
  return (
    <label className={`campo${largo ? " campo-largo" : ""}${erro ? " campo-invalido" : ""}`}>
      <span className="campo-rotulo">{rotulo}{obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}</span>
      {children}
      {erro ? <span className="campo-erro">{erro}</span> : aviso ? <span className="campo-aviso">{aviso}</span> : ajuda ? <span className="campo-ajuda">{ajuda}</span> : null}
    </label>
  );
}

/** Filtros em abas com contagem. */
export function Filtros<T extends string>({ opcoes, valor, onChange, rotulo }: {
  opcoes: [T, string, number?][]; valor: T; onChange: (v: T) => void; rotulo: string;
}) {
  return (
    <div className="segmentos" role="tablist" aria-label={rotulo}>
      {opcoes.map(([v, texto, contagem]) => (
        <button key={v} type="button" role="tab" aria-selected={valor === v} className={valor === v ? "ativo" : ""} onClick={() => onChange(v)}>
          {texto}{contagem != null && <> <span>{contagem}</span></>}
        </button>
      ))}
    </div>
  );
}

/** Cabeçalho de página com subtítulo e ações à direita. */
export function TopoPagina({ titulo, subtitulo, children }: { titulo: string; subtitulo?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pagina-topo noprint">
      <div>
        <h2>{titulo}</h2>
        {subtitulo && <p className="pagina-sub">{subtitulo}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export const normalizarTexto = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
export const num = (n: number) => Number(n || 0).toLocaleString("pt-BR");
export const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
