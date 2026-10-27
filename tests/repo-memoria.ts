import type { CamposCorrida, CentroCusto, Conversa, Corrida, Fornecedor, LocalCadastrado, NovaCorrida, Repo, Solicitante, Unidade } from "../lib/bot/tipos";
import { transicaoValida, type OrigemEvento, type StatusCorrida } from "../lib/status";
import { variantesTelefone } from "../lib/telefone";
import { inicioDoMesSP } from "../lib/datas";
import { escolherPrecoTrecho, pontasDoPreco, type LinhaPreco } from "../lib/precos";

/** Repositório em memória para testar o bot sem banco. Aplica as mesmas regras de transição do Postgres. */
export class RepoMemoria implements Repo {
  solicitantes: Solicitante[] = [];
  fornecedores: Fornecedor[] = [];
  unidades: Unidade[] = [];
  locais: LocalCadastrado[] = [];
  precos: LinhaPreco[] = [];
  centros: CentroCusto[] = [];
  parametros: Record<string, string> = {};
  conversas = new Map<string, Conversa>();
  corridas: Corrida[] = [];
  eventos: { corrida_id: string; de: StatusCorrida | null; para: StatusCorrida; origem: OrigemEvento; obs?: string | null }[] = [];
  private seq = 0;

  async solicitantePorTelefone(t: string) { const v = variantesTelefone(t); return this.solicitantes.find((s) => v.includes(s.telefone_whatsapp)) ?? null; }
  async fornecedorPorTelefone(t: string) { const v = variantesTelefone(t); return this.fornecedores.find((f) => v.includes(f.telefone_whatsapp)) ?? null; }
  async solicitante(id: string) { return this.solicitantes.find((s) => s.id === id) ?? null; }
  async fornecedor(id: string) { return this.fornecedores.find((f) => f.id === id) ?? null; }
  async fornecedoresAtivos() { return this.fornecedores.filter((f) => f.ativo); }
  async unidade(id: string) { return this.unidades.find((u) => u.id === id) ?? null; }
  private precoPara(fornecedorId: string, c: Corrida) {
    const pontas = pontasDoPreco(c, this.unidades.map((u) => u.nome)).map((p) => ({ texto: c[p] }));
    return escolherPrecoTrecho(this.precos.filter((l) => l.fornecedor_id === fornecedorId), pontas, c.qtd_passageiros || 1);
  }
  async precoTabela(c: Corrida) {
    const p = c.fornecedor_id ? this.precoPara(c.fornecedor_id, c) : null;
    return p ? { valor: p.valor, descricao: p.descricao } : null;
  }
  async cotacao(fornecedorId: string, c: Corrida) {
    if (!this.precos.some((l) => l.fornecedor_id === fornecedorId)) return { atende: true, valor: null };
    const p = this.precoPara(fornecedorId, c);
    return { atende: !!p, valor: p?.valor ?? null };
  }
  async locaisCadastrados() {
    return [
      ...this.unidades.filter((u) => u.endereco_padrao && u.ativo !== false)
        .map((u) => ({ id: u.id, nome: u.nome, endereco: u.endereco_padrao!, lat: u.lat ?? null, lng: u.lng ?? null, tipo: "unidade" as const })),
      ...this.locais,
    ];
  }
  async centroCusto(id: string) { return this.centros.find((c) => c.id === id) ?? null; }
  async centrosCusto(unidadeId?: string | null) { return this.centros.filter((c) => !unidadeId || !c.unidade_id || c.unidade_id === unidadeId); }
  async parametro(chave: string) { return this.parametros[chave] ?? null; }

  async conversa(t: string) { return this.conversas.get(t) ?? null; }
  async salvarConversa(t: string, etapa: string, dados: Record<string, any>, agora: Date) {
    this.conversas.set(t, { telefone: t, etapa, dados: JSON.parse(JSON.stringify(dados)), atualizado_em: agora.toISOString() });
  }
  async apagarConversa(t: string) { this.conversas.delete(t); }

  async criarCorrida(n: NovaCorrida) {
    this.seq += 1;
    const c: Corrida = {
      id: `c${this.seq}`, token_fornecedor: `tok${this.seq}`, fornecedores_tentados: [], protocolo: `TX-2026-${String(this.seq).padStart(5, "0")}`, fornecedor_id: null, status: "solicitada",
      criado_em: new Date().toISOString(), ...n, centro_custo_id: n.centro_custo_id ?? null,
    } as Corrida;
    this.corridas.push(c);
    this.eventos.push({ corrida_id: c.id, de: null, para: "solicitada", origem: "bot" });
    return { ...c };
  }
  async corrida(id: string) { const c = this.corridas.find((x) => x.id === id); return c ? { ...c } : null; }
  async corridaPorProtocolo(p: string) { const c = this.corridas.find((x) => x.protocolo === p.trim().toUpperCase()); return c ? { ...c } : null; }
  async mudarStatus(id: string, status: StatusCorrida | null, origem: OrigemEvento, obs?: string | null, campos: CamposCorrida = {}) {
    const c = this.corridas.find((x) => x.id === id);
    if (!c) throw new Error("Corrida não encontrada");
    if (status && !transicaoValida(c.status, status)) throw new Error(`Mudança de status não permitida: ${c.status} → ${status}`);
    const de = c.status;
    Object.assign(c, campos);
    if (status) c.status = status;
    this.eventos.push({ corrida_id: id, de, para: c.status, origem, obs });
    return { ...c };
  }
  async corridasDoSolicitante(id: string, limite: number) { return this.corridas.filter((c) => c.solicitante_id === id).reverse().slice(0, limite); }
  async corridasComPrazoVencido(agora: Date) { return this.corridas.filter((c) => c.status === "enviada" && c.prazo_resposta_em && new Date(c.prazo_resposta_em) < agora); }
  async gastoDoMes(id: string, agora: Date) {
    const inicio = inicioDoMesSP(agora).getTime();
    return this.corridas.filter((c) => c.solicitante_id === id && ["concluida", "validada", "contestada"].includes(c.status)
      && new Date(c.data_hora_prevista).getTime() >= inicio).reduce((s, c) => s + Number(c.valor_informado ?? 0), 0);
  }
  async corridasParaLembrete(agora: Date, ate: Date) {
    return this.corridas.filter((c) => c.tipo === "agendada" && ["enviada", "aceita"].includes(c.status) && !c.lembrete_enviado_em
      && new Date(c.data_hora_prevista) > agora && new Date(c.data_hora_prevista) <= ate);
  }
}

export function repoExemplo() {
  const r = new RepoMemoria();
  r.unidades.push({ id: "u1", nome: "Unidade Centro", endereco_padrao: "R. das Indústrias, 450" });
  r.centros.push(
    { id: "cc1", codigo: "CC 4100", descricao: "Logística", unidade_id: "u1", teto_por_corrida: 150, ativo: true },
    { id: "cc2", codigo: "CC 2300", descricao: "Comercial", unidade_id: "u1", teto_por_corrida: null, ativo: true },
  );
  r.fornecedores.push(
    { id: "f1", nome: "Rádio Táxi Central", telefone_whatsapp: "5511900000101", prioridade: 1, prazo_resposta_min: 10, ativo: true },
    { id: "f2", nome: "Coop Táxi Express", telefone_whatsapp: "5511900000102", prioridade: 2, prazo_resposta_min: 10, ativo: true, bandeirada: 6, valor_km: 3 },
  );
  r.solicitantes.push({ id: "s1", nome: "Ana Ribeiro", telefone_whatsapp: "5511900000001", unidade_id: "u1", centro_custo_padrao_id: "cc1", fornecedor_padrao_id: "f1", ativo: true });
  r.parametros = { planejamento_telefones: "5511900000900", avisar_planejamento_toda_corrida: "sim", conversa_expira_min: "15", antecedencia_maxima_dias: "30", prazo_agendada_min: "120", reenvio_automatico: "nao" };
  return r;
}
