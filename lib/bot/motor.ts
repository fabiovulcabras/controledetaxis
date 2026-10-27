import type { Corrida, Entrada, Fornecedor, LocalCadastrado, Opcao, Repo, Saida, Solicitante } from "./tipos";
import { CANCELAVEIS, STATUS } from "../status";
import { brl, formatarDataHora, lerDataHora, lerValor } from "../datas";
import { normalizarTelefone } from "../telefone";
import { alertar, avisarPlanejamento, avisarSolicitante, cancelarCorrida, despachar, escolherFornecedor, numero, reenviarAutomatico, telefonesPlanejamento, verificarValor } from "./acoes";

/**
 * Motor do bot: recebe uma mensagem e devolve as mensagens a enviar.
 * Quem fala é identificado pelo telefone: fornecedor, pessoa autorizada, planejamento ou número desconhecido.
 * Não envia nada sozinho; quem chama decide se manda pela Meta ou só grava no histórico.
 */
export async function processarEntrada(entrada: Entrada, repo: Repo, agora: Date): Promise<Saida[]> {
  const telefone = normalizarTelefone(entrada.telefone);
  const e: Entrada = { ...entrada, telefone, texto: (entrada.texto ?? "").trim() };
  if (!(await deveAtender(e, repo, agora))) return [];

  const fornecedor = await repo.fornecedorPorTelefone(telefone);
  if (fornecedor?.ativo) return fluxoFornecedor(fornecedor, e, repo, agora);

  const solicitante = await repo.solicitantePorTelefone(telefone);
  if (solicitante?.ativo) return fluxoSolicitante(solicitante, e, repo, agora);

  const planejamento = (await telefonesPlanejamento(repo)).map(normalizarTelefone);
  if (planejamento.includes(telefone)) {
    return [{ para: telefone, texto: "Este é o número de solicitação de táxis. Acompanhe e trate as corridas pelo painel." }];
  }
  return naoAutorizado(telefone, repo, agora);
}

// ---------------------------------------------------------------- Palavra de ativação
const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Palavras do parâmetro palavra_ativacao (separadas por vírgula), sem acento e em minúsculas. Vazio = bot sempre ativo. */
export async function palavrasAtivacao(repo: Repo): Promise<string[]> {
  return String((await repo.parametro("palavra_ativacao")) ?? "").split(",").map((p) => semAcento(p)).filter(Boolean);
}

/** A mensagem contém alguma das palavras, como palavra inteira ("taxi" vale em "Preciso de um táxi", não em "taxista"). */
export function contemPalavra(texto: string | undefined, palavras: string[]): boolean {
  const t = semAcento(texto ?? "");
  return palavras.some((p) => new RegExp(`(^|[^a-z0-9])${escaparRegex(p)}([^a-z0-9]|$)`).test(t));
}

const ACAO_FORNECEDOR = /^(ACEITAR|RECUSAR|EMBARCOU|NAO_REALIZADA):/;
const ETAPAS_FORNECEDOR = ["motorista", "valor", "aguardando"];

/**
 * Com palavra de ativação (Cadastros › Parâmetros › palavra_ativacao), o bot só responde quando:
 *  - a mensagem contém a palavra; ou
 *  - a pessoa já está numa conversa com o bot (dentro de conversa_expira_min); ou
 *  - é um fornecedor respondendo a uma corrida (1/2, botões, dados do motorista, valor).
 * O resto é ignorado em silêncio: útil quando o número do bot também é usado para conversas comuns.
 */
export async function deveAtender(entrada: Entrada, repo: Repo, agora: Date): Promise<boolean> {
  const palavras = await palavrasAtivacao(repo);
  if (!palavras.length || contemPalavra(entrada.texto, palavras)) return true;
  const telefone = normalizarTelefone(entrada.telefone);
  const conv = await repo.conversa(telefone);
  const fornecedor = await repo.fornecedorPorTelefone(telefone);
  if (fornecedor?.ativo) return ACAO_FORNECEDOR.test(entrada.botaoId ?? "") || (!!conv && ETAPAS_FORNECEDOR.includes(conv.etapa));
  if (!conv || conv.etapa === "nao_autorizado") return false;
  const expiraMin = await numero(repo, "conversa_expira_min", 15);
  return agora.getTime() - new Date(conv.atualizado_em).getTime() <= expiraMin * 60_000;
}

/** Fim de uma conversa: com palavra de ativação, a conversa é encerrada (a próxima precisa da palavra); sem, volta ao menu. */
async function encerrarConversa(repo: Repo, tel: string, agora: Date): Promise<void> {
  if ((await palavrasAtivacao(repo)).length) await repo.apagarConversa(tel);
  else await repo.salvarConversa(tel, "menu", {}, agora);
}

// ---------------------------------------------------------------- Número desconhecido
async function naoAutorizado(telefone: string, repo: Repo, agora: Date): Promise<Saida[]> {
  const saidas: Saida[] = [{
    para: telefone,
    texto: "Este número não está autorizado a solicitar táxis. Se você precisa desse acesso, procure o setor de planejamento.",
  }];
  // Avisa o planejamento no máximo uma vez a cada 24 h por número
  const conv = await repo.conversa(telefone);
  const ultimo = conv?.etapa === "nao_autorizado" ? new Date(conv.atualizado_em).getTime() : 0;
  if (agora.getTime() - ultimo > 24 * 3600_000) {
    await repo.salvarConversa(telefone, "nao_autorizado", {}, agora);
    saidas.push(...await avisarPlanejamento(repo, "alerta_corrida_planejamento", ["-", `tentativa de solicitação pelo número não autorizado ${telefone}`, "-", "-"]));
  }
  return saidas;
}

// ---------------------------------------------------------------- Pessoa autorizada
const MENU: Opcao[] = [
  { id: "pedir", titulo: "Pedir táxi" },
  { id: "minhas", titulo: "Minhas corridas" },
  { id: "cancelar", titulo: "Cancelar corrida" },
];
const OPCOES_QUANDO: Opcao[] = [{ id: "agora", titulo: "Agora" }, { id: "agendar", titulo: "Agendar" }];
const OPCOES_PAX: Opcao[] = [{ id: "pax:1", titulo: "Só eu" }, { id: "pax:2", titulo: "2 pessoas" }, { id: "pax:3", titulo: "3 ou mais" }];
const OPCOES_MOTIVO: Opcao[] = [{ id: "motivo:Visita a cliente", titulo: "Visita a cliente" }, { id: "motivo:Viagem / aeroporto", titulo: "Viagem/aeroporto" }, { id: "motivo:Hora extra", titulo: "Hora extra" }];
const OPCOES_CONFIRMAR: Opcao[] = [{ id: "confirmar", titulo: "Confirmar" }, { id: "corrigir", titulo: "Corrigir" }, { id: "descartar", titulo: "Cancelar" }];
const OPCOES_MOTIVO_CANCEL: Opcao[] = [{ id: "mc:Não preciso mais", titulo: "Não preciso mais" }, { id: "mc:Mudou o horário", titulo: "Mudou o horário" }, { id: "mc:Outro motivo", titulo: "Outro motivo" }];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Resolve o que a pessoa escolheu: botão tocado, número da opção ou o próprio título digitado. */
function escolha(e: Entrada, opcoes: Opcao[]): string | null {
  if (e.botaoId && opcoes.some((o) => o.id === e.botaoId)) return e.botaoId;
  const t = semAcento(e.texto ?? "");
  if (!t) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) return opcoes[n - 1].id;
  return opcoes.find((o) => semAcento(o.titulo) === t || semAcento(o.id) === t)?.id ?? null;
}

const pergunta = (para: string, texto: string, opcoes?: Opcao[], rotuloLista?: string): Saida => ({ para, texto, opcoes, rotuloLista });

async function fluxoSolicitante(sol: Solicitante, e: Entrada, repo: Repo, agora: Date): Promise<Saida[]> {
  const tel = e.telefone;
  const primeiroNome = sol.nome.split(" ")[0];
  let conv = await repo.conversa(tel);
  const saidas: Saida[] = [];

  const expiraMin = await numero(repo, "conversa_expira_min", 15);
  if (conv && agora.getTime() - new Date(conv.atualizado_em).getTime() > expiraMin * 60_000) {
    await repo.apagarConversa(tel);
    if (!["menu", "nao_autorizado"].includes(conv.etapa)) {
      saidas.push({ para: tel, texto: "Sua solicitação anterior ficou sem resposta e foi descartada." });
    }
    conv = null;
  }

  const menu = async (texto = `Olá, ${primeiroNome}! O que você precisa?`): Promise<Saida[]> => {
    await repo.salvarConversa(tel, "menu", {}, agora);
    return [...saidas, pergunta(tel, texto, MENU)];
  };
  if (!conv) return menu();
  if (/^(menu|inicio|voltar|sair)$/.test(semAcento(e.texto ?? ""))) return menu();

  const dados = { ...conv.dados };
  const ir = async (etapa: string, s: Saida | Saida[], novos: Record<string, any> = {}) => {
    await repo.salvarConversa(tel, etapa, { ...dados, ...novos, tentativas: 0 }, agora);
    return [...saidas, ...(Array.isArray(s) ? s : [s])];
  };
  const invalida = async (repetir: Saida) => {
    const tentativas = (dados.tentativas ?? 0) + 1;
    if (tentativas >= 3) {
      await repo.salvarConversa(tel, "menu", {}, agora);
      return [...saidas, pergunta(tel, "Não consegui entender. Vamos recomeçar. Se precisar de ajuda, fale com o setor de planejamento.", MENU)];
    }
    await repo.salvarConversa(tel, conv!.etapa, { ...dados, tentativas }, agora);
    return [...saidas, repetir];
  };

  // Perguntas de cada etapa (reaproveitadas quando a resposta não é entendida)
  const unidade = sol.unidade_id ? await repo.unidade(sol.unidade_id) : null;
  const pQuando = () => pergunta(tel, "Para quando é o táxi?", OPCOES_QUANDO);
  const pData = () => pergunta(tel, "Informe a data e a hora. Exemplos: 24/10 07:30, amanhã 7h, hoje 18:40.");
  // Unidades e locais frequentes cadastrados viram opções de origem e destino (a unidade da pessoa primeiro)
  let cacheLocais: LocalCadastrado[] | null = null;
  const locais = async () => {
    if (!cacheLocais) {
      const todos = await repo.locaisCadastrados();
      cacheLocais = [...todos.filter((l) => l.id === unidade?.id), ...todos.filter((l) => l.id !== unidade?.id)].slice(0, 10);
    }
    return cacheLocais;
  };
  const idLocal = (l: LocalCadastrado, padrao: "origem" | "destino") => (l.id === unidade?.id ? `${padrao}_unidade` : `local:${l.id}`);
  const pLugar = async (padrao: "origem" | "destino"): Promise<Saida> => {
    const lista = await locais();
    const pergunta1 = padrao === "origem" ? "De onde sai?" : "Para onde vai?";
    if (!lista.length) return pergunta(tel, `${pergunta1} Envie o endereço ou a localização.`);
    return pergunta(tel, `${pergunta1} Envie o endereço ou a localização, ou escolha um local cadastrado.`,
      lista.map((l) => ({ id: idLocal(l, padrao), titulo: l.nome.slice(0, 24), descricao: l.endereco.slice(0, 72) })), "Locais cadastrados");
  };
  const pOrigem = () => pLugar("origem");
  const pDestino = () => pLugar("destino");
  const pPax = () => pergunta(tel, "Quantos passageiros?", OPCOES_PAX);
  const pMotivo = () => pergunta(tel, "Qual o motivo da corrida? Escolha ou escreva.", OPCOES_MOTIVO);
  const resumo = async (d: Record<string, any>) => {
    return pergunta(tel, [
      "Confira sua solicitação:", "",
      `Quando: ${d.tipo === "imediata" ? "agora" : formatarDataHora(d.data_hora_prevista)}`,
      `Origem: ${d.origem}`, `Destino: ${d.destino}`,
      `Passageiros: ${d.qtd_passageiros}${d.outros_passageiros ? ` (${d.outros_passageiros})` : ""}`,
      `Motivo: ${d.motivo}`,
    ].join("\n"), OPCOES_CONFIRMAR);
  };
  const lugar = async (padrao: "origem" | "destino") => {
    if (e.localizacao) {
      const { nome, endereco, lat, lng } = e.localizacao;
      // Local escolhido no mapa (nome + endereço), endereço da localização atual, ou as coordenadas se não houver endereço
      const texto = nome && endereco && !endereco.startsWith(nome) ? `${nome} – ${endereco}` : endereco || nome || `Localização ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      return { texto, lat, lng };
    }
    const comoLugar = (l: LocalCadastrado) => ({ texto: `${l.nome} – ${l.endereco}`, lat: l.lat, lng: l.lng });
    const lista = await locais();
    const escolhido = e.botaoId ? lista.find((l) => idLocal(l, padrao) === e.botaoId) : null;
    if (escolhido) return comoLugar(escolhido);
    // Número da opção digitado ("1") ou o nome do local escrito ("pronto socorro municipal")
    const t = semAcento(e.texto ?? "");
    const n = Number(t);
    if (!e.botaoId && Number.isInteger(n) && n >= 1 && n <= lista.length) return comoLugar(lista[n - 1]);
    const porNome = t.length >= 4 ? lista.filter((l) => semAcento(l.nome) === t || (t.length >= 5 && semAcento(l.nome).startsWith(t))) : [];
    if (!e.botaoId && porNome.length === 1) return comoLugar(porNome[0]);
    if ((e.texto ?? "").length >= 4 && !e.botaoId) return { texto: e.texto!, lat: null, lng: null };
    return null;
  };

  switch (conv.etapa) {
    case "menu": {
      const op = escolha(e, MENU) ?? (/(taxi|pedir|corrida nova)/.test(semAcento(e.texto ?? "")) ? "pedir" : null);
      if (op === "pedir") return ir("quando", pQuando(), {});
      if (op === "minhas") {
        const lista = await repo.corridasDoSolicitante(sol.id, 5);
        await repo.salvarConversa(tel, "menu", {}, agora);
        if (!lista.length) return [...saidas, pergunta(tel, "Você ainda não tem corridas registradas.", MENU)];
        return [...saidas, pergunta(tel, "Suas últimas corridas:\n\n" + lista.map((c) =>
          `${c.protocolo} · ${formatarDataHora(c.data_hora_prevista)}\n${c.destino}\n${STATUS[c.status].rotulo}`).join("\n\n"), MENU)];
      }
      if (op === "cancelar") {
        const abertas = (await repo.corridasDoSolicitante(sol.id, 20)).filter((c) => CANCELAVEIS.includes(c.status)).slice(0, 10);
        if (!abertas.length) return menu("Você não tem corridas em aberto. O que você precisa?");
        return ir("cancelar_escolha", pergunta(tel, "Qual corrida você quer cancelar?",
          abertas.map((c) => ({ id: `cancelar:${c.id}`, titulo: c.protocolo, descricao: `${formatarDataHora(c.data_hora_prevista)} · ${c.destino}`.slice(0, 72) })), "Ver corridas"));
      }
      return menu();
    }

    case "quando": {
      const op = escolha(e, OPCOES_QUANDO);
      if (op === "agora") return ir("origem", await pOrigem(), { tipo: "imediata", data_hora_prevista: agora.toISOString() });
      if (op === "agendar") return ir("data", pData());
      const direto = e.texto ? lerDataHora(e.texto, agora) : null;
      if (direto) return validarData(direto);
      return invalida(pQuando());
    }

    case "data": {
      const d = e.texto ? lerDataHora(e.texto, agora) : null;
      if (!d) return invalida(pergunta(tel, "Não entendi a data. Envie no formato dia/mês hora, por exemplo 24/10 07:30."));
      return validarData(d);
    }

    case "origem": {
      const l = await lugar("origem");
      if (!l) return invalida(await pOrigem());
      return ir("destino", await pDestino(), { origem: l.texto, origem_lat: l.lat, origem_lng: l.lng });
    }

    case "destino": {
      const l = await lugar("destino");
      if (!l) return invalida(await pDestino());
      return ir("passageiros", pPax(), { destino: l.texto, destino_lat: l.lat, destino_lng: l.lng });
    }

    case "passageiros": {
      const op = escolha(e, OPCOES_PAX);
      const digitado = Number((e.texto ?? "").replace(/\D/g, ""));
      const qtd = op ? Number(op.split(":")[1]) : Number.isInteger(digitado) && digitado >= 1 && digitado <= 20 ? digitado : 0;
      if (!qtd) return invalida(pPax());
      if (qtd === 1) return ir("motivo", pMotivo(), { qtd_passageiros: 1, outros_passageiros: null });
      if (op === "pax:3") return ir("passageiros_qtd", pergunta(tel, "Quantas pessoas no total, contando você?"));
      return ir("passageiros_nomes", pergunta(tel, `Informe o nome ${qtd === 2 ? "do outro passageiro" : "dos outros passageiros"}.`), { qtd_passageiros: qtd });
    }

    case "passageiros_qtd": {
      const qtd = Number((e.texto ?? "").replace(/\D/g, ""));
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return invalida(pergunta(tel, "Envie só o número de pessoas, por exemplo 4."));
      if (qtd === 1) return ir("motivo", pMotivo(), { qtd_passageiros: 1, outros_passageiros: null });
      return ir("passageiros_nomes", pergunta(tel, "Informe o nome dos outros passageiros."), { qtd_passageiros: qtd });
    }

    case "passageiros_nomes": {
      if ((e.texto ?? "").length < 2) return invalida(pergunta(tel, "Escreva o nome dos outros passageiros."));
      return ir("motivo", pMotivo(), { outros_passageiros: e.texto });
    }

    case "centro_custo": // conversa antiga, de antes de o centro de custo sair do pedido
      return ir("motivo", pMotivo());

    case "motivo": {
      const op = escolha(e, OPCOES_MOTIVO);
      const motivo = op ? op.slice("motivo:".length) : (e.texto ?? "").length >= 3 && !e.botaoId ? e.texto! : null;
      if (!motivo) return invalida(pMotivo());
      const novos = { ...dados, motivo };
      return ir("confirmar", await resumo(novos), { motivo });
    }

    case "confirmar": {
      const op = escolha(e, OPCOES_CONFIRMAR);
      if (op === "corrigir") {
        await repo.salvarConversa(tel, "quando", {}, agora);
        return [...saidas, pergunta(tel, "Vamos refazer. Para quando é o táxi?", OPCOES_QUANDO)];
      }
      if (op === "descartar") return menu("Solicitação descartada. Precisa de mais alguma coisa?");
      if (op !== "confirmar") return invalida(await resumo(dados));
      return [...saidas, ...await registrar(sol, dados, repo, agora)];
    }

    case "cancelar_escolha": {
      const id = e.botaoId?.startsWith("cancelar:") ? e.botaoId.slice("cancelar:".length) : null;
      const c = id ? await repo.corrida(id) : e.texto ? await repo.corridaPorProtocolo(e.texto.toUpperCase()) : null;
      if (!c || c.solicitante_id !== sol.id) return invalida(pergunta(tel, "Toque em uma das corridas da lista ou envie o protocolo (ex.: TX-2026-00123)."));
      if (!CANCELAVEIS.includes(c.status)) return menu(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}" e não pode mais ser cancelada.`);
      return ir("cancelar_motivo", pergunta(tel, `Por que cancelar a corrida ${c.protocolo}?`, OPCOES_MOTIVO_CANCEL), { corrida_id: c.id });
    }

    case "cancelar_motivo": {
      const op = escolha(e, OPCOES_MOTIVO_CANCEL);
      const motivo = op ? op.slice(3) : (e.texto ?? "").length >= 3 ? e.texto! : null;
      if (!motivo) return invalida(pergunta(tel, "Escolha ou escreva o motivo do cancelamento.", OPCOES_MOTIVO_CANCEL));
      const c = await repo.corrida(dados.corrida_id);
      if (!c || !CANCELAVEIS.includes(c.status)) {
        await repo.salvarConversa(tel, "menu", {}, agora);
        return [...saidas, pergunta(tel, "Essa corrida não pode mais ser cancelada.", MENU)];
      }
      await encerrarConversa(repo, tel, agora);
      const r = await cancelarCorrida(repo, c, motivo, "bot");
      const avisouFornecedor = r.saidas.some((s) => s.template?.nome === "corrida_cancelada_fornecedor");
      return [...saidas, pergunta(tel, `Corrida ${c.protocolo} cancelada.${avisouFornecedor ? " O fornecedor foi avisado." : ""}`), ...r.saidas];
    }

    default:
      return menu();
  }

  async function validarData(d: Date): Promise<Saida[]> {
    const maxDias = await numero(repo, "antecedencia_maxima_dias", 30);
    if (d.getTime() < agora.getTime() - 60_000) return invalida(pergunta(tel, "Essa data e hora já passaram. Informe uma data e hora futuras."));
    if (d.getTime() > agora.getTime() + maxDias * 86400_000) return invalida(pergunta(tel, `Só é possível agendar até ${maxDias} dias à frente. Informe outra data.`));
    return ir("origem", await pOrigem(), { tipo: "agendada", data_hora_prevista: d.toISOString() });
  }
}

/** Grava a corrida, envia ao fornecedor e avisa o planejamento. */
async function registrar(sol: Solicitante, d: Record<string, any>, repo: Repo, agora: Date): Promise<Saida[]> {
  const tel = sol.telefone_whatsapp;
  const corrida = await repo.criarCorrida({
    solicitante_id: sol.id, tipo: d.tipo ?? "imediata",
    data_hora_prevista: d.data_hora_prevista ?? agora.toISOString(), origem: d.origem, destino: d.destino,
    origem_lat: d.origem_lat ?? null, origem_lng: d.origem_lng ?? null, destino_lat: d.destino_lat ?? null, destino_lng: d.destino_lng ?? null,
    qtd_passageiros: d.qtd_passageiros ?? 1, outros_passageiros: d.outros_passageiros ?? null, motivo: d.motivo,
  });
  await encerrarConversa(repo, tel, agora);

  const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id, corrida);
  if (!forn) {
    return [
      { para: tel, corridaId: corrida.id, texto: `Solicitação ${corrida.protocolo} registrada. Não há fornecedor ativo cadastrado; o planejamento foi avisado e vai entrar em contato.` },
      ...await alertar(repo, corrida, "nenhum fornecedor ativo para enviar a corrida"),
    ];
  }
  const { corrida: enviada, saidas } = await despachar(repo, corrida, forn, agora, "bot");
  const resultado: Saida[] = [
    { para: tel, corridaId: corrida.id, texto: `Solicitação ${corrida.protocolo} registrada. Enviamos ao fornecedor ${forn.nome} e avisaremos quando ele responder.` },
    ...saidas,
  ];
  if (semAcento((await repo.parametro("avisar_planejamento_toda_corrida")) ?? "sim") !== "nao") {
    resultado.push(...await avisarPlanejamento(repo, "nova_corrida_planejamento", [
      enviada.protocolo, sol.nome, enviada.tipo === "imediata" ? "agora" : formatarDataHora(enviada.data_hora_prevista),
      enviada.origem, enviada.destino, forn.nome,
    ], enviada.id));
  }
  return resultado;
}

// ---------------------------------------------------------------- Fornecedor
/** " Valor da tabela: R$ 164,00 (Toledo - Pereiras · Passeio)." ou vazio quando não há tabela para a corrida. */
async function textoTabela(repo: Repo, c: Corrida): Promise<string> {
  const t = await repo.precoTabela(c).catch(() => null);
  return t ? ` Valor da tabela: ${brl(t.valor)} (${t.descricao}).` : "";
}

const ACOES_FORNECEDOR = /^(ACEITAR|RECUSAR|EMBARCOU|NAO_REALIZADA):(.+)$/;

async function fluxoFornecedor(forn: Fornecedor, e: Entrada, repo: Repo, agora: Date): Promise<Saida[]> {
  const tel = e.telefone;
  const responder = (texto: string, opcoes?: Opcao[], corridaId?: string): Saida => ({ para: tel, texto, opcoes, corridaId });
  const m = e.botaoId?.match(ACOES_FORNECEDOR);

  if (m) {
    const [, acao, ref] = m;
    const c = (await repo.corridaPorProtocolo(ref)) ?? (await repo.corrida(ref));
    if (!c) return [responder("Não encontrei essa corrida.")];
    if (c.fornecedor_id !== forn.id) return [responder(`A corrida ${c.protocolo} foi direcionada a outro fornecedor. Não é preciso fazer nada.`)];
    if (c.status === "cancelada") return [responder(`A corrida ${c.protocolo} foi cancelada. Não é preciso fazer nada.`)];

    if (acao === "ACEITAR") {
      if (!["enviada", "sem_resposta"].includes(c.status)) return [responder(`A corrida ${c.protocolo} já está como "${STATUS[c.status].rotulo}".`)];
      const atrasado = c.status === "sem_resposta";
      const atual = await repo.mudarStatus(c.id, "aceita", "fornecedor", atrasado ? "Aceita depois do prazo" : "Aceita pelo fornecedor");
      await repo.salvarConversa(tel, "motorista", { corrida_id: c.id }, agora);
      const saidas: Saida[] = [responder(`Corrida ${c.protocolo} aceita. Informe motorista, placa e previsão de chegada em uma mensagem. Exemplo: Carlos Souza, RTX4F21, 12 min`, undefined, c.id)];
      if (atrasado) saidas.push(...await alertar(repo, atual, "aceita pelo fornecedor depois do prazo"));
      return saidas;
    }

    if (acao === "RECUSAR") {
      if (!["enviada", "sem_resposta"].includes(c.status)) return [responder(`A corrida ${c.protocolo} já está como "${STATUS[c.status].rotulo}".`)];
      const atual = await repo.mudarStatus(c.id, "recusada", "fornecedor", "Recusada pelo fornecedor", { motivo_recusa: "Recusada pelo fornecedor" });
      await repo.apagarConversa(tel);
      const ok = responder(`Recusa da corrida ${c.protocolo} registrada. Obrigado por avisar.`, undefined, c.id);
      const r = await reenviarAutomatico(repo, atual, agora);
      if (r) {
        return [ok, ...r.saidas, ...await avisarSolicitante(repo, r.corrida,
          `O fornecedor ${forn.nome} não atendeu a corrida ${c.protocolo}. Enviamos a ${r.fornecedor.nome} e avisaremos quando responder.`, `recusada; enviada a ${r.fornecedor.nome}`)];
      }
      return [
        ok,
        ...await avisarSolicitante(repo, atual, `O fornecedor ${forn.nome} não atendeu a corrida ${c.protocolo}. O planejamento foi avisado e vai providenciar outro fornecedor.`, "o fornecedor recusou; o planejamento foi avisado"),
        ...await alertar(repo, atual, "recusada pelo fornecedor"),
      ];
    }

    if (acao === "EMBARCOU") {
      if (c.status !== "aceita") return [responder(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}".`)];
      await repo.mudarStatus(c.id, "em_andamento", "fornecedor", "Passageiro embarcou");
      await repo.salvarConversa(tel, "valor", { corrida_id: c.id }, agora);
      return [responder(`Embarque da corrida ${c.protocolo} registrado. Ao terminar, envie o valor da corrida (exemplo: 68,50).${await textoTabela(repo, c)}`, undefined, c.id)];
    }

    if (acao === "NAO_REALIZADA") {
      if (!["aceita", "em_andamento"].includes(c.status)) return [responder(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}".`)];
      await repo.apagarConversa(tel);
      const r = await cancelarCorrida(repo, c, "Fornecedor informou que a corrida não foi realizada", "fornecedor");
      return [
        responder(`Corrida ${c.protocolo} registrada como não realizada.`, undefined, c.id),
        ...await avisarSolicitante(repo, r.corrida, `O fornecedor informou que a corrida ${c.protocolo} não foi realizada. Se ainda precisar do táxi, faça uma nova solicitação.`, "não realizada, segundo o fornecedor"),
        ...await alertar(repo, r.corrida, "fornecedor informou que a corrida não foi realizada"),
      ];
    }
  }

  // Respostas em texto dependem da etapa em que o fornecedor está
  const conv = await repo.conversa(tel);
  const c = conv?.dados?.corrida_id ? await repo.corrida(conv.dados.corrida_id) : null;

  if (conv?.etapa === "motorista" && c && c.status === "aceita") {
    const d = lerMotorista(e.texto ?? "");
    if (!d.motorista) return [responder("Envie motorista, placa e previsão em uma mensagem. Exemplo: Carlos Souza, RTX4F21, 12 min")];
    const atual = await repo.mudarStatus(c.id, null, "fornecedor", "Dados do motorista informados", d);
    await repo.salvarConversa(tel, "aguardando", { corrida_id: c.id }, agora);
    const detalhes = [d.motorista, d.veiculo_placa ? `placa ${d.veiculo_placa}` : null, d.eta_minutos ? `chegada em cerca de ${d.eta_minutos} min` : null].filter(Boolean).join(", ");
    return [
      responder(`Dados registrados para a corrida ${c.protocolo}. Toque abaixo quando o passageiro embarcar, ou envie o valor ao final.${await textoTabela(repo, atual)}`,
        [{ id: `EMBARCOU:${c.protocolo}`, titulo: "Passageiro embarcou" }, { id: `NAO_REALIZADA:${c.protocolo}`, titulo: "Não realizada" }], c.id),
      ...await avisarSolicitante(repo, atual, `Sua corrida ${c.protocolo} foi aceita por ${forn.nome}. Motorista: ${detalhes}.`, `aceita por ${forn.nome}. Motorista: ${detalhes}`),
    ];
  }

  if ((conv?.etapa === "valor" || conv?.etapa === "aguardando") && c && ["aceita", "em_andamento"].includes(c.status)) {
    const valor = lerValor(e.texto ?? "");
    if (valor == null || valor <= 0) {
      return [responder(conv.etapa === "valor"
        ? "Envie só o valor da corrida, por exemplo 68,50."
        : `Para a corrida ${c.protocolo}, toque em "Passageiro embarcou" ou envie o valor final (exemplo: 68,50).`)];
    }
    const atual = await repo.mudarStatus(c.id, "concluida", "fornecedor", `Concluída, valor informado ${brl(valor)}`, { valor_informado: valor });
    await repo.apagarConversa(tel);
    const tabela = await repo.precoTabela(atual).catch(() => null);
    const situacao = !tabela ? "" : valor > tabela.valor + 0.005
      ? ` O valor está acima da tabela (${brl(tabela.valor)}); o planejamento vai conferir.`
      : " Valor dentro da tabela.";
    return [
      responder(`Valor de ${brl(valor)} registrado para a corrida ${c.protocolo}.${situacao} Obrigado!`, undefined, c.id),
      ...await verificarValor(repo, atual, valor, agora),
    ];
  }

  return [responder("Para responder a uma corrida, use as opções da mensagem dela (botão ou número: 1 aceita, 2 recusa). Depois de aceitar, envie aqui os dados do motorista; ao final, o valor.")];
}

/** "Carlos Souza, RTX4F21, 12 min" → motorista, placa, minutos. */
export function lerMotorista(texto: string): { motorista: string | null; veiculo_placa: string | null; eta_minutos: number | null } {
  const t = texto.trim();
  const placa = t.match(/\b([A-Za-z]{3})-?(\d[A-Za-z0-9]\d{2})\b/);
  const minutos = t.match(/(\d{1,3})\s*(?:min|minutos?|m)\b/i);
  let nome = t;
  if (placa) nome = nome.replace(placa[0], " ");
  if (minutos) nome = nome.replace(minutos[0], " ");
  nome = nome.replace(/\b(placa|motorista|previs[aã]o|chega(?:da)?|em)\b/gi, " ").replace(/[,;|\-–]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    motorista: nome.length >= 2 ? nome : null,
    veiculo_placa: placa ? `${placa[1]}${placa[2]}`.toUpperCase() : null,
    eta_minutos: minutos ? Number(minutos[1]) : null,
  };
}
