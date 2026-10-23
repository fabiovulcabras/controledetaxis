import type { SupabaseClient } from "@supabase/supabase-js";
import type { CamposCorrida, CentroCusto, Conversa, Corrida, Fornecedor, NovaCorrida, Repo, Solicitante, Unidade } from "./tipos";
import type { OrigemEvento, StatusCorrida } from "../status";
import { variantesTelefone } from "../telefone";

const falhar = (contexto: string, error: { message: string } | null) => {
  if (error) throw new Error(`${contexto}: ${error.message}`);
};

/** Repositório do bot sobre o Supabase. Use com o cliente service role (servidor). */
export class RepoSupabase implements Repo {
  private cacheParametros: Record<string, string> | null = null;
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
  async solicitante(id: string) { return this.um<Solicitante>("solicitantes", id); }
  async fornecedor(id: string) { return this.um<Fornecedor>("fornecedores", id); }
  async unidade(id: string) { return this.um<Unidade>("unidades", id); }
  async centroCusto(id: string) { return this.um<CentroCusto>("centros_custo", id); }
  async fornecedoresAtivos() {
    const { data, error } = await this.db.from("fornecedores").select("*").eq("ativo", true).order("prioridade");
    falhar("Listar fornecedores", error);
    return (data ?? []) as Fornecedor[];
  }
  async centrosCusto(unidadeId?: string | null) {
    let q = this.db.from("centros_custo").select("*").eq("ativo", true).order("codigo");
    if (unidadeId) q = q.or(`unidade_id.eq.${unidadeId},unidade_id.is.null`);
    const { data, error } = await q;
    falhar("Listar centros de custo", error);
    return (data ?? []) as CentroCusto[];
  }
  async parametro(chave: string) {
    if (!this.cacheParametros) {
      const { data, error } = await this.db.from("parametros").select("chave,valor");
      falhar("Ler parâmetros", error);
      this.cacheParametros = Object.fromEntries((data ?? []).map((p: any) => [p.chave, p.valor]));
    }
    return this.cacheParametros[chave] ?? null;
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

  private async um<T>(tabela: string, id: string): Promise<T | null> {
    const { data, error } = await this.db.from(tabela).select("*").eq("id", id).maybeSingle();
    falhar(`Ler ${tabela}`, error);
    return (data as T) ?? null;
  }
}
