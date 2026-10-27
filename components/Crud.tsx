"use client";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/UI";
import { Campo, Filtros, PainelLateral, TopoPagina, normalizarTexto } from "@/components/Formulario";
import { formatarTelefone, normalizarTelefone, soDigitos } from "@/lib/telefone";
import { useRetorno } from "@/components/Retorno";

/** Opções de um select: vindas de uma tabela, ou uma lista fixa. */
export type Opcoes = { tabela?: string; valor?: string; rotulo?: (r: any) => string; fixas?: { valor: string; rotulo: string }[] };
export type CampoCrud = {
  key: string; label: string; required?: boolean; type?: "text" | "email" | "number" | "select"; ajuda?: string; largo?: boolean;
  placeholder?: string; mascara?: "cnpj" | "whatsapp"; unico?: boolean; opcoes?: Opcoes; esconderNaTabela?: boolean; moeda?: boolean;
};
type Filtro = "ativos" | "inativos" | "todos";

function aplicarMascara(valor: string, mascara?: CampoCrud["mascara"]) {
  const d = soDigitos(valor);
  if (mascara === "cnpj") {
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return d.slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return valor;
}
const mensagemErro = (error: { code?: string; message: string }) =>
  error.code === "23505" ? "Já existe um cadastro com estes dados."
    : error.code === "23514" ? "Algum campo está em formato inválido. Confira o telefone (DDD + número)."
    : error.code === "42501" || /row-level security|permission denied/i.test(error.message) ? "Você não tem permissão para alterar este cadastro."
    : /does not exist|could not find the table|schema cache/i.test(error.message) ? `O banco ainda não tem esta tabela ou coluna. Rode as migrações pendentes de supabase/ no SQL Editor do Supabase (${error.message}).`
    : error.message;

export default function Crud({ table, title, subtitulo, nomeItem, fields, ordem, aviso, aoSalvar, semAtivo, acoesExtras }: {
  table: string; title: string; subtitulo?: string; nomeItem: string; fields: CampoCrud[]; ordem?: string;
  aviso?: ReactNode; aoSalvar?: () => void; semAtivo?: boolean;
  /** Botões a mais na coluna Ações de cada linha. */
  acoesExtras?: (registro: any, recarregar: () => Promise<void>) => ReactNode;
}) {
  const { confirmar, avisar } = useRetorno();
  const [rows, setRows] = useState<any[]>([]);
  const [opcoes, setOpcoes] = useState<Record<string, { valor: string; rotulo: string }[]>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>(semAtivo ? "todos" : "ativos");
  const [busca, setBusca] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from(table).select("*").order(ordem ?? fields[0].key);
    if (error) setErr(mensagemErro(error));
    setRows(data ?? []);
    const listas: Record<string, { valor: string; rotulo: string }[]> = {};
    for (const f of fields.filter((x) => x.opcoes)) {
      if (f.opcoes!.fixas) { listas[f.key] = f.opcoes!.fixas; continue; }
      const { data: d } = await supabase.from(f.opcoes!.tabela!).select("*");
      listas[f.key] = (d ?? []).map((r: any) => ({ valor: String(r[f.opcoes!.valor ?? "id"]), rotulo: f.opcoes!.rotulo!(r) }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
    }
    setOpcoes(listas);
  };
  useEffect(() => { void load(); }, [table]);

  const exibir = (f: CampoCrud, r: any): string | null => {
    const v = r[f.key];
    if (v == null || v === "") return null;
    if (f.opcoes) return opcoes[f.key]?.find((o) => o.valor === String(v))?.rotulo ?? "—";
    if (f.moeda) return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    if (f.mascara === "whatsapp") return formatarTelefone(String(v));
    if (f.mascara === "cnpj") return aplicarMascara(String(v), "cnpj");
    return String(v);
  };

  // ---------- Validação ----------
  const erros: Record<string, string> = {};
  for (const f of fields) {
    const valor = (form[f.key] ?? "").trim();
    if (f.required && !valor) erros[f.key] = `Informe ${f.label.toLowerCase()}.`;
    else if (valor && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) erros[f.key] = "E-mail inválido.";
    else if (valor && f.type === "number" && !Number.isFinite(Number(valor.replace(",", ".")))) erros[f.key] = "Informe um número.";
    else if (valor && f.mascara === "cnpj" && ![11, 14].includes(soDigitos(valor).length)) erros[f.key] = "Informe 14 dígitos (CNPJ) ou 11 (CPF).";
    else if (valor && f.mascara === "whatsapp" && !/^\d{12,13}$/.test(normalizarTelefone(valor))) erros[f.key] = "Informe DDD + número, por exemplo (11) 98812-4471.";
    else if (valor && f.unico) {
      const comparar = (v: string) => f.mascara === "whatsapp" ? normalizarTelefone(v) : f.mascara ? soDigitos(v) : normalizarTexto(v);
      const repetido = rows.find((r) => r.id !== editandoId && r[f.key] && comparar(String(r[f.key])) === comparar(valor));
      if (repetido) erros[f.key] = `Já usado por "${repetido[fields[0].key]}".`;
    }
  }
  const temErros = Object.keys(erros).length > 0;
  const erroDe = (key: string) => (tentou || (form[key] ?? "") !== "") ? erros[key] : undefined;

  const abrirNovo = () => { setEditandoId(null); setForm({}); setErr(""); setOk(""); setTentou(false); setAberto(true); };
  const editar = (r: any) => {
    setEditandoId(r.id);
    setForm(Object.fromEntries(fields.map((f) => [f.key, r[f.key] == null ? "" : f.mascara === "whatsapp" ? formatarTelefone(String(r[f.key])) : aplicarMascara(String(r[f.key]), f.mascara)])));
    setErr(""); setOk(""); setTentou(false); setAberto(true);
  };
  const fechar = () => { setAberto(false); setEditandoId(null); setForm({}); setErr(""); };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setTentou(true); setErr("");
    if (temErros) { setErr("Corrija os campos destacados."); return; }
    setSalvando(true);
    const clean = Object.fromEntries(fields.map((f) => {
      const valor = (form[f.key] ?? "").trim();
      if (valor === "") return [f.key, null];
      if (f.mascara === "cnpj") return [f.key, soDigitos(valor)];
      if (f.mascara === "whatsapp") return [f.key, normalizarTelefone(valor)];
      if (f.type === "number") return [f.key, Number(valor.replace(",", "."))];
      return [f.key, valor];
    }));
    const { error } = editandoId ? await supabase.from(table).update(clean).eq("id", editandoId) : await supabase.from(table).insert(clean);
    setSalvando(false);
    if (error) { setErr(mensagemErro(error)); return; }
    avisar(`${clean[fields[0].key]} ${editandoId ? "atualizado" : "cadastrado"}.`);
    fechar(); await load(); aoSalvar?.();
  };

  const toggle = async (r: any) => {
    if (r.ativo && !(await confirmar({ titulo: `Desativar "${r[fields[0].key]}"?`, texto: "O histórico é mantido e o cadastro deixa de aparecer nas novas operações.", confirmar: "Desativar", perigo: true }))) return;
    setErr(""); setOk("");
    const { error } = await supabase.from(table).update({ ativo: !r.ativo }).eq("id", r.id);
    if (error) setErr(mensagemErro(error)); else { avisar(`${r[fields[0].key]} ${r.ativo ? "desativado" : "reativado"}.`); await load(); aoSalvar?.(); }
  };

  const noFiltro = (r: any, f: Filtro) => semAtivo || f === "todos" ? true : f === "ativos" ? r.ativo : !r.ativo;
  const termo = normalizarTexto(busca);
  const lista = rows.filter((r) => noFiltro(r, filtro))
    .filter((r) => !termo || fields.some((f) => normalizarTexto(exibir(f, r) ?? "").includes(termo) || (f.mascara && soDigitos(busca) !== "" && soDigitos(String(r[f.key] ?? "")).includes(soDigitos(busca)))));
  const visiveis = fields.filter((f) => !f.esconderNaTabela);
  const [principal, ...secundarios] = visiveis;

  return (
    <>
      <TopoPagina titulo={title} subtitulo={subtitulo ?? (semAtivo ? `${rows.length} cadastro(s)` : `${rows.filter((r) => r.ativo).length} ativo(s)`)}>
        <button type="button" className="pri" onClick={abrirNovo}>+ Novo {nomeItem}</button>
      </TopoPagina>
      {aviso}
      {ok && !aberto && <div className="ok">{ok}</div>}
      {err && !aberto && <div className="err">{err}</div>}

      <section className="card">
        <div className="repor-filtros">
          {!semAtivo && <Filtros<Filtro> rotulo="Filtrar" valor={filtro} onChange={setFiltro}
            opcoes={[["ativos", "Ativos", rows.filter((r) => r.ativo).length], ["inativos", "Inativos", rows.filter((r) => !r.ativo).length], ["todos", "Todos", rows.length]]} />}
          <input type="search" placeholder={`Buscar por ${visiveis.map((f) => f.label.toLowerCase()).slice(0, 3).join(", ")}`} value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="tw">
          <table>
            <thead><tr>
              <th>{principal.label}</th>
              {secundarios.map((f) => <th key={f.key} className={f.type === "number" ? "num" : ""}>{f.label}</th>)}
              <th>Ações</th>
            </tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} className={semAtivo || r.ativo ? "" : "linha-inativa"}>
                  <td><div className="repor-produto">{exibir(principal, r)}</div>{!semAtivo && !r.ativo && <Badge variant="danger">Inativo</Badge>}</td>
                  {secundarios.map((f) => <td key={f.key} className={f.type === "number" ? "num" : ""}>{exibir(f, r) ?? <span className="texto-fraco">—</span>}</td>)}
                  <td><div className="row" style={{ flexWrap: "nowrap" }}>
                    {acoesExtras?.(r, load)}
                    <button type="button" className="ghost" onClick={() => editar(r)}>Editar</button>
                    {!semAtivo && <button type="button" className="ghost" onClick={() => toggle(r)}>{r.ativo ? "Desativar" : "Reativar"}</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!lista.length && <p className="empty">{termo ? "Nada corresponde à busca." : rows.length ? "Nenhum cadastro neste filtro." : "Nada cadastrado ainda."}</p>}
      </section>

      {aberto && <PainelLateral titulo={editandoId ? `Editar ${nomeItem}` : `Novo ${nomeItem}`} subtitulo={editandoId ? form[fields[0].key] : undefined} onFechar={fechar} ocupado={salvando} largura={560}>
        <form className="painel-corpo" noValidate onSubmit={salvar}>
          <fieldset className="secao">
            <legend>Dados</legend>
            {fields.map((f, i) => (
              <Campo key={f.key} rotulo={f.label} obrigatorio={f.required} erro={erroDe(f.key)} ajuda={f.ajuda} largo={f.largo ?? i === 0}>
                {f.opcoes ? (
                  <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                    <option value="">{f.required ? "Selecione" : "Nenhum"}</option>
                    {(opcoes[f.key] ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                  </select>
                ) : (
                  <input type={f.type === "email" ? "email" : "text"} inputMode={f.mascara ? "numeric" : f.type === "number" ? "decimal" : f.type === "email" ? "email" : undefined}
                    autoFocus={i === 0} value={form[f.key] ?? ""} placeholder={f.placeholder} maxLength={200}
                    onChange={(e) => setForm({ ...form, [f.key]: aplicarMascara(e.target.value, f.mascara) })} />
                )}
              </Campo>
            ))}
          </fieldset>
          {err && <div className="err">{err}</div>}
          <footer className="painel-rodape">
            <button type="button" className="ghost" onClick={fechar} disabled={salvando}>Cancelar</button>
            <button className="pri" disabled={salvando}>{salvando ? "Salvando..." : editandoId ? "Salvar alterações" : "Cadastrar"}</button>
          </footer>
        </form>
      </PainelLateral>}
    </>
  );
}
