import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalCadastrado, CamposCorrida, Conversa, Corrida, Fornecedor, NovaCorrida, Repo, Solicitante, Unidade } from "./tipos";
import type { OrigemEvento, StatusCorrida } from "../status";
import { variantesTelefone } from "../telefone";
import { inicioDoMesSP } from "../datas";
import { escolherPrecoTrecho, pontasDoPreco, type LinhaPreco, type Onde } from "../precos";
import { localidadePorCoordenadas, localidadePorTexto } from "../endereco";

/** Motivos usados enquanto a tabela de motivos não existe. */
export const MOTIVOS_PADRAO = ["Visita a cliente", "Viagem / aeroporto", "Hora extra"];

const falhar = (contexto: string, error: { message: string } | null) => {
  if (error) throw new Error(`${contexto}: ${error.message}`);
};

/** Repositório do bot sobre o Supabase. Use com o cliente service role (servidor). */
export class RepoSupabase implements Repo {
  private cacheParametros: Record<string, string> | null = null;
  /** Cadastros mudam pouco: cada um é lido no máximo uma vez por requisição. Corridas nunca vão para o cache. */
  private cache = new Map<string, Promise<any>>();
  constructor(private db: SupabaseClient) {}

  async solicitantePorTelefone(t: string) {
    const { data, error } = await this.db.from("solicitantes").select("*").in("telefone_whatsapp", variantesTelefone(t)).limit(1);
    falhar("Buscar solicitante", error);
    return (data?.[0] as Solicitante) ?? null;
  }
  async fornecedorPorTelefone(t: string) {
    const { data, error } = await this.db.from("fornecedores").select("*").in("telefone_whatsapp", variantesTelefone(t)).limit(1);
    falhar("Buscar fornecedor", error);
    return (data?.[0] as Fornecedor) ?? null;
  }
  async solicitante(id: string) { return this.emCache<Solicitante>("solicitantes", id); }
  async fornecedor(id: string) { return this.emCache<Fornecedor>("fornecedores", id); }
  async unidade(id: string) { return this.emCache<Unidade>("unidades", id); }
  /**
   * Calcula (uma vez por fornecedor) e grava na corrida o valor da tabela. A cidade e o bairro vêm do mapa:
   * pelas coordenadas do ponto, quando há; senão pela busca do endereço escrito.
   */
  async precoTabela(c: Corrida): Promise<{ valor: number; descricao: string } | null> {
    if (!c.fornecedor_id) return null;
    if (c.preco_calculado_em && c.preco_fornecedor_id === c.fornecedor_id) {
      return c.valor_tabela != null ? { valor: Number(c.valor_tabela), descricao: c.preco_descricao ?? "" } : null;
    }
    const linhas = await this.linhasPreco(c.fornecedor_id);
    if (!linhas.length) return null; // sem a migração 008 ou sem tabela para este fornecedor
    const p = escolherPrecoTrecho(linhas, await this.pontasDaCorrida(c), c.qtd_passageiros || 1);
    const campos = {
      valor_tabela: p?.valor ?? null, preco_id: p?.linha.id ?? null, preco_descricao: p?.descricao ?? null,
      preco_fornecedor_id: c.fornecedor_id, preco_calculado_em: new Date().toISOString(),
    };
    const { error: e2 } = await this.db.from("corridas").update(campos).eq("id", c.id);
    if (e2) console.error("Gravar valor de tabela", e2.message);
    Object.assign(c, campos);
    return p ? { valor: p.valor, descricao: p.descricao } : null;
  }
  async cotacao(fornecedorId: string, c: Corrida): Promise<{ atende: boolean; valor: number | null }> {
    const linhas = await this.linhasPreco(fornecedorId);
    if (!linhas.length) return { atende: true, valor: null };
    const p = escolherPrecoTrecho(linhas, await this.pontasDaCorrida(c), c.qtd_passageiros || 1);
    return { atende: !!p, valor: p?.valor ?? null };
  }
  private linhasPreco(fornecedorId: string): Promise<LinhaPreco[]> {
    const chave = `precos:${fornecedorId}`;
    if (!this.cache.has(chave)) {
      this.cache.set(chave, Promise.resolve(this.db.from("precos_tabela").select("*").eq("fornecedor_id", fornecedorId).eq("ativo", true))
        .then(({ data, error }) => (error ? [] : (data ?? []) as LinhaPreco[])));
    }
    return this.cache.get(chave)!;
  }
  /** Cidade e bairro das pontas que contam para o preço (pelo mapa), lidos uma vez por corrida. */
  private pontasDaCorrida(c: Corrida): Promise<Onde[]> {
    const chave = `pontas:${c.id}`;
    if (!this.cache.has(chave)) {
      this.cache.set(chave, (async () => {
        const unidades = (await this.locaisCadastrados()).filter((l) => l.tipo === "unidade").map((l) => l.nome);
        const ondes: Onde[] = [];
        for (const ponta of pontasDoPreco(c, unidades)) { // uma de cada vez: o Nominatim pede no máximo 1 consulta por segundo
          const texto = ponta === "origem" ? c.origem : c.destino;
          const lat = ponta === "origem" ? c.origem_lat : c.destino_lat;
          const lng = ponta === "origem" ? c.origem_lng : c.destino_lng;
          const mapa = lat != null && lng != null
            ? await localidadePorCoordenadas(Number(lat), Number(lng), process.env.NEXT_PUBLIC_APP_URL || "app interno")
            : await localidadePorTexto(texto);
          ondes.push({ cidade: mapa?.cidade ?? null, bairros: mapa?.bairros ?? [], texto: [texto, mapa?.texto].filter(Boolean).join(" ") });
        }
        return ondes;
      })());
    }
    return this.cache.get(chave)!;
  }
  async locaisCadastrados(): Promise<LocalCadastrado[]> {
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const [u, l] = await Promise.all([
      this.db.from("unidades").select("*").eq("ativo", true).order("nome"),
      this.db.from("locais").select("*").eq("ativo", true).order("nome"), // sem a migração 005, só as unidades
    ]);
    falhar("Ler unidades", u.error);
    return [
      ...(u.data ?? []).filter((x: any) => String(x.endereco_padrao ?? "").trim())
        .map((x: any) => ({ id: x.id, nome: x.nome, endereco: String(x.endereco_padrao).trim(), lat: num(x.lat), lng: num(x.lng), tipo: "unidade" as const })),
      ...(l.error ? [] : l.data ?? []).map((x: any) => ({ id: x.id, nome: x.nome, endereco: String(x.endereco).trim(), lat: num(x.lat), lng: num(x.lng), tipo: "local" as const })),
    ];
  }
  async fornecedoresAtivos() {
    const { data, error } = await this.db.from("fornecedores").select("*").eq("ativo", true).order("prioridade");
    falhar("Listar fornecedores", error);
    return (data ?? []) as Fornecedor[];
  }

  async motivos(): Promise<string[]> {
    const chave = "motivos";
    if (!this.cache.has(chave)) {
      this.cache.set(chave, Promise.resolve(this.db.from("motivos").select("nome").eq("ativo", true).order("ordem").order("nome"))
        // Sem a migração 010 (ou sem nenhum ativo), usa os motivos de antes
        .then(({ data, error }) => (error || !data?.length ? MOTIVOS_PADRAO : data.map((m: any) => String(m.nome)))));
    }
    return this.cache.get(chave)!;
  }
  async parametro(chave: string) {
    let params = this.cacheParametros;
    if (!params) {
      const { data, error } = await this.db.from("parametros").select("chave,valor");
      falhar("Ler parâmetros", error);
      params = Object.fromEntries((data ?? []).map((p: any) => [p.chave, p.valor])) as Record<string, string>;
      this.cacheParametros = params;
    }
    return params[chave] ?? null;
  }

  async conversa(t: string) {
    const { data, error } = await this.db.from("conversas_bot").select("*").eq("telefone", t).maybeSingle();
    falhar("Ler conversa", error);
    return (data as Conversa) ?? null;
  }
  async salvarConversa(t: string, etapa: string, dados: Record<string, any>, agora: Date) {
    const { error } = await this.db.from("conversas_bot").upsert({ telefone: t, etapa, dados, atualizado_em: agora.toISOString() });
    falhar("Salvar conversa", error);
  }
  async apagarConversa(t: string) {
    const { error } = await this.db.from("conversas_bot").delete().eq("telefone", t);
    falhar("Apagar conversa", error);
  }

  async criarCorrida(n: NovaCorrida) {
    const { data, error } = await this.db.from("corridas").insert(n).select("*").single();
    falhar("Criar corrida", error);
    return data as Corrida;
  }
  async corrida(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return this.um<Corrida>("corridas", id);
  }
  async corridaPorProtocolo(p: string) {
    const { data, error } = await this.db.from("corridas").select("*").eq("protocolo", p.trim().toUpperCase()).maybeSingle();
    falhar("Buscar corrida", error);
    return (data as Corrida) ?? null;
  }
  async mudarStatus(id: string, status: StatusCorrida | null, origem: OrigemEvento, obs?: string | null, campos: CamposCorrida = {}) {
    const { data, error } = await this.db.rpc("fn_mudar_status", { p_corrida: id, p_status: status, p_origem: origem, p_obs: obs ?? null, p_campos: campos });
    falhar("Atualizar corrida", error);
    return data as Corrida;
  }
  async corridasDoSolicitante(id: string, limite: number) {
    const { data, error } = await this.db.from("corridas").select("*").eq("solicitante_id", id).order("criado_em", { ascending: false }).limit(limite);
    falhar("Listar corridas", error);
    return (data ?? []) as Corrida[];
  }
  async corridasComPrazoVencido(agora: Date) {
    const { data, error } = await this.db.from("corridas").select("*").eq("status", "enviada").lt("prazo_resposta_em", agora.toISOString()).limit(50);
    falhar("Corridas com prazo vencido", error);
    return (data ?? []) as Corrida[];
  }
  async corridasParaLembrete(agora: Date, ate: Date) {
    const { data, error } = await this.db.from("corridas").select("*").eq("tipo", "agendada").in("status", ["enviada", "aceita"])
      .is("lembrete_enviado_em", null).gt("data_hora_prevista", agora.toISOString()).lte("data_hora_prevista", ate.toISOString()).limit(50);
    falhar("Corridas para lembrete", error);
    return (data ?? []) as Corrida[];
  }

  async gastoDoMes(id: string, agora: Date) {
    const { data, error } = await this.db.from("corridas").select("valor_informado").eq("solicitante_id", id)
      .in("status", ["concluida", "validada", "contestada"]).gte("data_hora_prevista", inicioDoMesSP(agora).toISOString());
    falhar("Gasto do mês", error);
    return (data ?? []).reduce((s: number, c: any) => s + Number(c.valor_informado ?? 0), 0);
  }

  private emCache<T>(tabela: string, id: string): Promise<T | null> {
    const chave = `${tabela}:${id}`;
    if (!this.cache.has(chave)) this.cache.set(chave, this.um<T>(tabela, id));
    return this.cache.get(chave)!;
  }

  private async um<T>(tabela: string, id: string): Promise<T | null> {
    const { data, error } = await this.db.from(tabela).select("*").eq("id", id).maybeSingle();
    falhar(`Ler ${tabela}`, error);
    return (data as T) ?? null;
  }
}
