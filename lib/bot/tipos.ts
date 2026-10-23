import type { OrigemEvento, StatusCorrida } from "../status";

export type Solicitante = {
  id: string; nome: string; matricula?: string | null; setor?: string | null; telefone_whatsapp: string;
  unidade_id?: string | null; centro_custo_padrao_id?: string | null; fornecedor_padrao_id?: string | null; ativo: boolean;
  token_pedido?: string;
  limite_mensal?: number | null;
};
export type Fornecedor = {
  id: string; nome: string; telefone_whatsapp: string; prioridade: number; prazo_resposta_min: number; ativo: boolean;
  bandeirada?: number | null; valor_km?: number | null; token_portal?: string;
};
export type Unidade = { id: string; nome: string; endereco_padrao?: string | null };
export type CentroCusto = { id: string; codigo: string; descricao: string; unidade_id?: string | null; teto_por_corrida?: number | null; ativo: boolean };

export type Corrida = {
  id: string; protocolo: string; solicitante_id: string; fornecedor_id: string | null; centro_custo_id: string | null;
  tipo: "imediata" | "agendada"; data_hora_prevista: string; origem: string; destino: string;
  origem_lat?: number | null; origem_lng?: number | null; destino_lat?: number | null; destino_lng?: number | null;
  qtd_passageiros: number; outros_passageiros?: string | null; motivo: string; status: StatusCorrida;
  motorista?: string | null; veiculo_placa?: string | null; eta_minutos?: number | null;
  valor_informado?: number | null; valor_faturado?: number | null; prazo_resposta_em?: string | null;
  lembrete_enviado_em?: string | null; motivo_recusa?: string | null; motivo_cancelamento?: string | null;
  token_fornecedor?: string;
  fornecedores_tentados?: string[];
  distancia_km?: number | null;
  chave_envio?: string | null;
  criado_em: string;
};

export type NovaCorrida = Pick<Corrida, "solicitante_id" | "centro_custo_id" | "tipo" | "data_hora_prevista" | "origem" | "destino" | "qtd_passageiros" | "motivo">
  & Partial<Pick<Corrida, "outros_passageiros" | "origem_lat" | "origem_lng" | "destino_lat" | "destino_lng" | "fornecedor_id" | "distancia_km" | "chave_envio">>;

export type CamposCorrida = Partial<Pick<Corrida,
  "fornecedor_id" | "motorista" | "veiculo_placa" | "eta_minutos" | "valor_informado" | "prazo_resposta_em" |
  "motivo_recusa" | "motivo_cancelamento" | "lembrete_enviado_em" | "token_fornecedor" | "fornecedores_tentados">>;

export type Conversa = { telefone: string; etapa: string; dados: Record<string, any>; atualizado_em: string };

/** Mensagem recebida, já normalizada (WhatsApp real). */
export type Entrada = {
  telefone: string;
  texto?: string;
  /** id do botão ou item de lista tocado (ou payload de botão de template) */
  botaoId?: string;
  localizacao?: { lat: number; lng: number; endereco?: string; nome?: string };
};

export type Opcao = { id: string; titulo: string; descricao?: string };

/** Modelo aprovado na Meta. "sempre" = a mensagem só pode sair como modelo (inicia conversa). */
export type UsoTemplate = { nome: string; parametros: string[]; botoes?: string[]; sempre?: boolean };

/** Mensagem a enviar. Com até 3 opções vira botões; com rotuloLista vira lista (até 10 itens). */
export type Saida = {
  para: string;
  texto: string;
  corridaId?: string | null;
  opcoes?: Opcao[];
  rotuloLista?: string;
  /** Sem "sempre": usado só se a janela de 24 h com o destinatário estiver fechada. */
  template?: UsoTemplate;
};

/** Acesso a dados usado pelo bot. Há uma versão com Supabase (produção) e outra em memória (testes). */
export interface Repo {
  solicitantePorTelefone(telefone: string): Promise<Solicitante | null>;
  fornecedorPorTelefone(telefone: string): Promise<Fornecedor | null>;
  solicitante(id: string): Promise<Solicitante | null>;
  fornecedor(id: string): Promise<Fornecedor | null>;
  fornecedoresAtivos(): Promise<Fornecedor[]>;
  unidade(id: string): Promise<Unidade | null>;
  centroCusto(id: string): Promise<CentroCusto | null>;
  centrosCusto(unidadeId?: string | null): Promise<CentroCusto[]>;
  parametro(chave: string): Promise<string | null>;

  conversa(telefone: string): Promise<Conversa | null>;
  salvarConversa(telefone: string, etapa: string, dados: Record<string, any>, agora: Date): Promise<void>;
  apagarConversa(telefone: string): Promise<void>;

  criarCorrida(nova: NovaCorrida): Promise<Corrida>;
  corrida(id: string): Promise<Corrida | null>;
  corridaPorProtocolo(protocolo: string): Promise<Corrida | null>;
  /** status null = só atualiza campos. Lança erro se a transição não for permitida. */
  mudarStatus(corridaId: string, status: StatusCorrida | null, origem: OrigemEvento, obs?: string | null, campos?: CamposCorrida): Promise<Corrida>;
  corridasDoSolicitante(solicitanteId: string, limite: number): Promise<Corrida[]>;
  corridasComPrazoVencido(agora: Date): Promise<Corrida[]>;
  corridasParaLembrete(agora: Date, ate: Date): Promise<Corrida[]>;
  /** Soma do valor informado das corridas concluídas da pessoa no mês de "agora". */
  gastoDoMes(solicitanteId: string, agora: Date): Promise<number>;
}
