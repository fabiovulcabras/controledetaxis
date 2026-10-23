"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Confirmação dentro da tela (no lugar do window.confirm) e avisos que somem sozinhos. */
type OpcoesConfirmar = { titulo: string; texto?: string; confirmar?: string; perigo?: boolean };
type Ctx = { confirmar: (o: OpcoesConfirmar) => Promise<boolean>; avisar: (texto: string, tipo?: "ok" | "erro") => void };
const RetornoCtx = createContext<Ctx>({ confirmar: async () => true, avisar: () => {} });
export const useRetorno = () => useContext(RetornoCtx);

export function RetornoProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<(OpcoesConfirmar & { resolver: (v: boolean) => void }) | null>(null);
  const [avisos, setAvisos] = useState<{ id: number; texto: string; tipo: "ok" | "erro" }[]>([]);
  const seq = useRef(0);
  const botao = useRef<HTMLButtonElement>(null);

  const confirmar = useCallback((o: OpcoesConfirmar) => new Promise<boolean>((resolver) => setPedido({ ...o, resolver })), []);
  const avisar = useCallback((texto: string, tipo: "ok" | "erro" = "ok") => {
    const id = ++seq.current;
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 8000 : 4500);
  }, []);
  const responder = (v: boolean) => { pedido?.resolver(v); setPedido(null); };

  useEffect(() => {
    if (!pedido) return;
    botao.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") responder(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pedido]);

  return (
    <RetornoCtx.Provider value={{ confirmar, avisar }}>
      {children}
      {pedido && (
        <>
          <button type="button" className="painel-fundo" aria-label="Cancelar" onClick={() => responder(false)} style={{ zIndex: 60 }} />
          <div className="confirmacao" role="alertdialog" aria-modal="true" aria-labelledby="confirmacao-titulo">
            <h3 id="confirmacao-titulo">{pedido.titulo}</h3>
            {pedido.texto && <p>{pedido.texto}</p>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={() => responder(false)}>Voltar</button>
              <button type="button" ref={botao} className={pedido.perigo ? "danger" : "pri"} onClick={() => responder(true)}>{pedido.confirmar ?? "Confirmar"}</button>
            </div>
          </div>
        </>
      )}
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => <div key={a.id} className={`aviso ${a.tipo}`}>{a.texto}</div>)}
      </div>
    </RetornoCtx.Provider>
  );
}
