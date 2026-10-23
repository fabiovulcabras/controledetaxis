"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TopoPagina } from "@/components/Formulario";
import { useApp } from "@/components/AuthGate";
import { useRetorno } from "@/components/Retorno";
import { formatarTelefone } from "@/lib/telefone";
import { linkWhatsApp } from "@/lib/whatsapp/link";

type Forn = { id: string; nome: string; telefone_whatsapp: string; token_portal?: string | null; ativo: boolean };

/** Lista os links fixos do portal de cada fornecedor, para enviar pelo WhatsApp, copiar ou abrir. */
export default function Portais() {
  const { admin } = useApp();
  const { confirmar, avisar } = useRetorno();
  const [lista, setLista] = useState<Forn[]>([]);
  const [err, setErr] = useState("");
  const [carregado, setCarregado] = useState(false);
  const base = typeof window !== "undefined" ? window.location.origin : "";

  const carregar = async () => {
    const { data, error } = await supabase.from("fornecedores").select("*").eq("ativo", true).order("prioridade");
    setErr(error ? error.message : "");
    setLista((data ?? []) as Forn[]);
    setCarregado(true);
  };
  useEffect(() => { void carregar(); }, []);

  const semMigracao = carregado && lista.length > 0 && lista.every((f) => !f.token_portal);
  const url = (f: Forn) => `${base}/fornecedor/${f.token_portal}`;
  const texto = (f: Forn) => `Olá, ${f.nome}! Este é o seu portal de corridas: ${url(f)}\nPor ele você vê as corridas para responder, as em andamento e as encerradas. Salve nos favoritos.`;
  const copiar = async (f: Forn) => {
    try { await navigator.clipboard.writeText(url(f)); avisar(`Link de ${f.nome} copiado.`); } catch { avisar("Não foi possível copiar."); }
  };
  const trocar = async (f: Forn) => {
    if (!(await confirmar({ titulo: `Gerar novo link do portal de ${f.nome}?`, texto: "O link atual para de funcionar na hora. Depois envie o novo ao fornecedor.", confirmar: "Gerar novo link", perigo: true }))) return;
    const novo = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    const { error } = await supabase.from("fornecedores").update({ token_portal: novo }).eq("id", f.id);
    if (error) setErr(error.message); else { avisar("Novo link gerado."); await carregar(); }
  };

  return (
    <>
      <TopoPagina titulo="Portais dos fornecedores" subtitulo="Cada fornecedor tem um link fixo onde vê todas as corridas dele: para responder, em andamento e encerradas. Envie uma vez; ele pode salvar nos favoritos." />
      {err && <div className="err">{err}</div>}
      {semMigracao && <div className="err">O banco ainda não tem os portais. No Supabase, abra o SQL Editor, rode <strong>supabase/003_melhorias.sql</strong> e recarregue esta página.</div>}
      <section className="card">
        {!carregado ? <p className="empty">Carregando…</p> : !lista.length ? <p className="empty">Nenhum fornecedor ativo. Cadastre em Cadastros › Fornecedores.</p> : (
          <div className="tw">
            <table>
              <thead><tr><th>Fornecedor</th><th>WhatsApp</th><th>Ações</th></tr></thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id}>
                    <td><div className="repor-produto">{f.nome}</div></td>
                    <td>{formatarTelefone(f.telefone_whatsapp)}</td>
                    <td>{f.token_portal ? (
                      <div className="row">
                        <a className="botao-whatsapp" style={{ margin: 0 }} href={linkWhatsApp(f.telefone_whatsapp, texto(f))} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
                        <button type="button" className="ghost" onClick={() => copiar(f)}>Copiar link</button>
                        <a className="ghost" href={url(f)} target="_blank" rel="noopener noreferrer">Abrir portal</a>
                        {admin && <button type="button" className="ghost botao-perigo" onClick={() => trocar(f)}>Gerar novo link</button>}
                      </div>
                    ) : <span className="texto-fraco">Rode a migração 003</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
