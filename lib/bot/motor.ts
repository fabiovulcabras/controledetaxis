import { MAX_DESTINOS, trajetoTexto } from "../multidestino";
import { formatarHora, formatarPlaca, lerDadosMotorista, lerHorarioChegada, nomeValido, placaValida, textoChegada } from "../motorista";
import type { Conversa, Corrida, Entrada, Fornecedor, LocalCadastrado, Opcao, Repo, Saida, Solicitante } from "./tipos";
import { CANCELAVEIS_SOLICITANTE, STATUS } from "../status";
import { brl, formatarDataHora, lerDataHora, lerValor } from "../datas";
import { normalizarTelefone } from "../telefone";
import { alertar, alterarCorrida, avisarPlanejamento, avisarSolicitante, cancelarCorrida, despacharOuSegurar, escolherFornecedor, numero, pedirAvaliacao, podeAlterar, reenviarAutomatico, telefonesPlanejamento, verificarValor } from "./acoes";

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

const ACAO_FORNECEDOR = /^(ACEITAR|RECUSAR|CHEGOU|EMBARCOU|NAO_REALIZADA):/;
const NOTA = /^NOTA:(.+):([1-5])$/;
const JANELA_AVALIACAO_MS = 24 * 3600_000;
const ETAPAS_FORNECEDOR = ["motorista", "placa", "chegada", "valor", "aguardando"];

/**
 * Com palavra de ativação (Cadastros › Parâmetros › palavra_ativacao), o bot só responde quando:
 *  - a mensagem contém a palavra; ou
 *  - a pessoa autorizada tem corrida aberta, ainda sem embarque (pode acompanhar ou cancelar); ou
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
  // Pessoa autorizada com corrida aberta (até o embarque): fala com o robô sem a palavra, para acompanhar ou cancelar
  const sol = await repo.solicitantePorTelefone(telefone);
  // Nota da corrida: o botão (vale sempre) ou o número de 1 a 5 / o comentário pedido, dentro de 24 h
  if (sol?.ativo && NOTA.test(entrada.botaoId ?? "")) return true;
  if (sol?.ativo && conv && agora.getTime() - new Date(conv.atualizado_em).getTime() <= JANELA_AVALIACAO_MS &&
    ((conv.etapa === "avaliar" && /^\s*[1-5]\s*$/.test(entrada.texto ?? "")) || (conv.etapa === "avaliar_comentario" && !!entrada.texto?.trim()))) return true;
  if (sol?.ativo && (await repo.corridasDoSolicitante(sol.id, 10)).some((c) => CANCELAVEIS_SOLICITANTE.includes(c.status))) return true;
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
  { id: "alterar", titulo: "Alterar corrida" },
];
const OPCOES_ALTERAR: Opcao[] = [{ id: "alt:horario", titulo: "Horário" }, { id: "alt:destino", titulo: "Destino" }, { id: "alt:pax", titulo: "Passageiros" }];
const OPCOES_QUANDO: Opcao[] = [{ id: "agora", titulo: "Agora" }, { id: "agendar", titulo: "Agendar" }];
const OPCOES_PAX: Opcao[] = [{ id: "pax:1", titulo: "Só eu" }, { id: "pax:2", titulo: "2 pessoas" }, { id: "pax:3", titulo: "3 ou mais" }];
const OPCOES_MAIS_DESTINO: Opcao[] = [{ id: "mais:nao", titulo: "Não, seguir" }, { id: "mais:sim", titulo: "Adicionar destino" }];
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

  // ---- Nota da corrida (pedida depois da conclusão): botão "NOTA:<id>:<n>" ou o número digitado
  const recente = !!conv && agora.getTime() - new Date(conv.atualizado_em).getTime() <= JANELA_AVALIACAO_MS;
  const mNota = e.botaoId?.match(NOTA);
  const digitada = !e.botaoId && conv?.etapa === "avaliar" && recente && /^[1-5]$/.test(e.texto ?? "") ? Number(e.texto) : null;
  if (mNota || digitada) {
    const c = await repo.corrida(mNota ? mNota[1] : String(conv!.dados.corrida_id));
    if (!c || c.solicitante_id !== sol.id) return [{ para: tel, texto: "Não encontrei essa corrida." }];
    const nota = mNota ? Number(mNota[2]) : digitada!;
    const gravou = await repo.avaliarCorrida?.(c.id, nota).catch(() => false);
    if (!gravou) {
      if (conv?.etapa === "avaliar") await repo.apagarConversa(tel);
      return [{ para: tel, corridaId: c.id, texto: c.avaliacao ? `A corrida ${c.protocolo} já foi avaliada. Obrigado!` : `Não foi possível registrar a nota da corrida ${c.protocolo}.` }];
    }
    if (nota <= 3) {
      await repo.salvarConversa(tel, "avaliar_comentario", { corrida_id: c.id }, agora);
      return [{ para: tel, corridaId: c.id, texto: `Nota ${nota} registrada. O que não foi bem? Escreva em uma mensagem (ou "pular").` }];
    }
    if (conv?.etapa === "avaliar") await repo.apagarConversa(tel);
    return [{ para: tel, corridaId: c.id, texto: `Nota ${nota} registrada. Obrigado pela avaliação!` }];
  }
  if (conv?.etapa === "avaliar_comentario" && recente && e.texto) {
    await repo.apagarConversa(tel);
    if (!/^(pular|nao|não|n)$/i.test(e.texto.trim())) await repo.avaliarCorrida?.(String(conv.dados.corrida_id), null, e.texto).catch(() => false);
    return [{ para: tel, texto: "Obrigado! O planejamento vai ver seu comentário." }];
  }
  // Pedido de nota sem resposta: segue a conversa normal
  if (conv && ["avaliar", "avaliar_comentario"].includes(conv.etapa)) { await repo.apagarConversa(tel); conv = null; }

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
  // Sem conversa em andamento: mostra o menu, a não ser que a mensagem já seja uma opção dele ("3" = cancelar)
  if (!conv && !escolha(e, MENU)) return menu();
  if (!conv) conv = { telefone: tel, etapa: "menu", dados: {}, atualizado_em: agora.toISOString() };
  const cv: Conversa = conv;
  if (/^(menu|inicio|voltar|sair)$/.test(semAcento(e.texto ?? ""))) return menu();

  const dados = { ...cv.dados };
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
  const pMaisDestino = (n: number) => pergunta(tel, `Vai a mais algum lugar nessa corrida? (${n} de ${MAX_DESTINOS} destinos)`, OPCOES_MAIS_DESTINO);
  const pDestinoExtra = async (): Promise<Saida> => {
    const p = await pLugar("destino");
    return { ...p, texto: p.texto.replace("Para onde vai?", "Qual o próximo destino?") };
  };
  const pPax = () => pergunta(tel, "Quantos passageiros?", OPCOES_PAX);
  // Motivos cadastrados (Cadastros › Motivos): até 3 viram botões; mais que isso, lista (até 10)
  const opcoesMotivo = async (): Promise<Opcao[]> => (await repo.motivos()).slice(0, 10).map((m) => ({ id: `motivo:${m}`, titulo: m.slice(0, 24) }));
  const pMotivo = async () => {
    const op = await opcoesMotivo();
    return pergunta(tel, "Qual o motivo da corrida? Escolha ou escreva.", op, op.length > 3 ? "Ver motivos" : undefined);
  };
  const resumo = async (d: Record<string, any>) => {
    return pergunta(tel, [
      "Confira sua solicitação:", "",
      `Quando: ${d.tipo === "imediata" ? "agora" : formatarDataHora(d.data_hora_prevista)}`,
      `Origem: ${d.origem}`,
      ...(Array.isArray(d.destinos_extras) && d.destinos_extras.length
        ? [`Destinos: ${[d.destino, ...d.destinos_extras.map((x: { texto: string }) => x.texto)].join("; ")}`,
           "(organizamos as paradas pelo menor trajeto; o destino mais longe fica como destino final)"]
        : [`Destino: ${d.destino}`]),
      `Passageiros: ${d.qtd_passageiros}${d.outros_passageiros ? ` (${d.outros_passageiros})` : ""}`,
      `Motivo: ${d.motivo}`,
      ...(d.observacoes ? [`Observações: ${d.observacoes}`] : []),
      "",
      d.observacoes ? "Para trocar a observação, escreva a nova antes de confirmar." : "Quer deixar uma observação para o fornecedor (bagagem, ponto de referência)? Escreva antes de confirmar.",
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

  switch (cv.etapa) {
    case "menu": {
      const op = escolha(e, MENU) ?? (/(taxi|pedir|corrida nova)/.test(semAcento(e.texto ?? "")) ? "pedir" : null);
      if (op === "pedir") return ir("quando", pQuando(), {});
      if (op === "minhas") {
        const lista = await repo.corridasDoSolicitante(sol.id, 5);
        await repo.salvarConversa(tel, "menu", {}, agora);
        if (!lista.length) return [...saidas, pergunta(tel, "Você ainda não tem corridas registradas.", MENU)];
        return [...saidas, pergunta(tel, "Suas últimas corridas:\n\n" + lista.map((c) =>
          `${c.protocolo} · ${formatarDataHora(c.data_hora_prevista)}\n${trajetoTexto(c)}\n${STATUS[c.status].rotulo}`).join("\n\n"), MENU)];
      }
      if (op === "alterar") {
        const abertas = (await repo.corridasDoSolicitante(sol.id, 20)).filter(podeAlterar).slice(0, 10);
        if (!abertas.length) return menu("Só dá para alterar corridas que o fornecedor ainda não aceitou, e você não tem nenhuma. Depois do aceite, cancele e peça de novo. O que você precisa?");
        return ir("alterar_escolha", pergunta(tel, "Qual corrida você quer alterar?",
          abertas.map((c) => ({ id: `alterar:${c.id}`, titulo: c.protocolo, descricao: `${formatarDataHora(c.data_hora_prevista)} · ${c.destino}`.slice(0, 72) })), "Ver corridas"));
      }
      if (op === "cancelar") {
        const abertas = (await repo.corridasDoSolicitante(sol.id, 20)).filter((c) => CANCELAVEIS_SOLICITANTE.includes(c.status)).slice(0, 10);
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
      return ir("mais_destino", pMaisDestino(1), { destino: l.texto, destino_lat: l.lat, destino_lng: l.lng, destinos_extras: [] });
    }

    // Vários destinos: até MAX_DESTINOS; a ordem e o destino final são decididos ao registrar (menor km)
    case "mais_destino": {
      const op = escolha(e, OPCOES_MAIS_DESTINO);
      const t = semAcento(e.texto ?? "");
      const sim = op === "mais:sim" || (!e.botaoId && /^(sim|s|adicionar|mais)$/.test(t));
      const nao = op === "mais:nao" || (!e.botaoId && /^(nao|n|seguir|nenhum)$/.test(t));
      const extras = Array.isArray(dados.destinos_extras) ? dados.destinos_extras : [];
      if (sim) return ir("destino_extra", await pDestinoExtra());
      if (nao) return ir("passageiros", pPax());
      return invalida(pMaisDestino(1 + extras.length));
    }

    case "destino_extra": {
      const l = await lugar("destino");
      if (!l) return invalida(await pDestinoExtra());
      const extras = [...(Array.isArray(dados.destinos_extras) ? dados.destinos_extras : []), { texto: l.texto, lat: l.lat, lng: l.lng }];
      if (1 + extras.length >= MAX_DESTINOS) {
        return ir("passageiros", [pergunta(tel, `Destino ${1 + extras.length} anotado. Esse é o limite de ${MAX_DESTINOS} destinos.`), pPax()], { destinos_extras: extras });
      }
      return ir("mais_destino", pMaisDestino(1 + extras.length), { destinos_extras: extras });
    }

    case "passageiros": {
      const op = escolha(e, OPCOES_PAX);
      const digitado = Number((e.texto ?? "").replace(/\D/g, ""));
      const qtd = op ? Number(op.split(":")[1]) : Number.isInteger(digitado) && digitado >= 1 && digitado <= 20 ? digitado : 0;
      if (!qtd) return invalida(pPax());
      if (qtd === 1) return ir("motivo", await pMotivo(), { qtd_passageiros: 1, outros_passageiros: null });
      if (op === "pax:3") return ir("passageiros_qtd", pergunta(tel, "Quantas pessoas no total, contando você?"));
      return ir("passageiros_nomes", pergunta(tel, `Informe o nome ${qtd === 2 ? "do outro passageiro" : "dos outros passageiros"}.`), { qtd_passageiros: qtd });
    }

    case "passageiros_qtd": {
      const qtd = Number((e.texto ?? "").replace(/\D/g, ""));
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) return invalida(pergunta(tel, "Envie só o número de pessoas, por exemplo 4."));
      if (qtd === 1) return ir("motivo", await pMotivo(), { qtd_passageiros: 1, outros_passageiros: null });
      return ir("passageiros_nomes", pergunta(tel, "Informe o nome dos outros passageiros."), { qtd_passageiros: qtd });
    }

    case "passageiros_nomes": {
      if ((e.texto ?? "").length < 2) return invalida(pergunta(tel, "Escreva o nome dos outros passageiros."));
      return ir("motivo", await pMotivo(), { outros_passageiros: e.texto });
    }

    case "centro_custo": // conversa antiga, de antes de o centro de custo sair do pedido
      return ir("motivo", await pMotivo());

    case "motivo": {
      const op = escolha(e, await opcoesMotivo());
      const motivo = op ? op.slice("motivo:".length) : (e.texto ?? "").length >= 3 && !e.botaoId ? e.texto! : null;
      if (!motivo) return invalida(await pMotivo());
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
      // Texto escrito na confirmação vira a observação da corrida (opcional) e o resumo é mostrado de novo
      const texto = (e.texto ?? "").trim();
      if (!op && !e.botaoId && !e.localizacao && texto.length >= 3) {
        const observacoes = texto.slice(0, 500);
        return ir("confirmar", await resumo({ ...dados, observacoes }), { observacoes });
      }
      if (op !== "confirmar") return invalida(await resumo(dados));
      return [...saidas, ...await registrar(sol, dados, repo, agora)];
    }

    case "alterar_escolha": {
      const abertas = (await repo.corridasDoSolicitante(sol.id, 20)).filter(podeAlterar).slice(0, 10);
      const op = escolha(e, abertas.map((x) => ({ id: `alterar:${x.id}`, titulo: x.protocolo })));
      const id = op?.startsWith("alterar:") ? op.slice("alterar:".length) : null;
      const c = id ? await repo.corrida(id) : e.texto ? await repo.corridaPorProtocolo(e.texto.toUpperCase()) : null;
      if (!c || c.solicitante_id !== sol.id) return invalida(pergunta(tel, "Toque em uma das corridas da lista ou envie o protocolo (ex.: TX-2026-00123)."));
      if (!podeAlterar(c)) return menu(`A corrida ${c.protocolo} já foi aceita pelo fornecedor e não pode mais ser alterada. Se precisar, cancele e peça de novo.`);
      return ir("alterar_o_que", pergunta(tel, `O que você quer alterar na corrida ${c.protocolo}?`, OPCOES_ALTERAR), { corrida_id: c.id });
    }

    case "alterar_o_que": {
      const op = escolha(e, OPCOES_ALTERAR);
      if (!op) return invalida(pergunta(tel, "Escolha o que alterar.", OPCOES_ALTERAR));
      if (op === "alt:horario") return ir("alterar_horario", pergunta(tel, "Qual o novo dia e horário? Exemplos: 24/10 07:30, amanhã 7h, hoje 18:40."));
      if (op === "alt:pax") return ir("alterar_pax", pergunta(tel, "Quantos passageiros agora? Envie o número (1 a 15)."));
      const c = await repo.corrida(String(dados.corrida_id));
      if (c && (c.paradas ?? []).length) return menu(`A corrida ${c.protocolo} tem várias paradas: para mudar os destinos, cancele e peça de novo. O que você precisa?`);
      return ir("alterar_destino", await pDestino());
    }

    case "alterar_horario":
    case "alterar_destino":
    case "alterar_pax": {
      const c = await repo.corrida(String(dados.corrida_id));
      if (!c || c.solicitante_id !== sol.id) return menu();
      if (!podeAlterar(c)) return menu(`A corrida ${c.protocolo} já foi aceita pelo fornecedor e não pode mais ser alterada.`);
      let campos: Parameters<typeof alterarCorrida>[2], descricao: string;
      if (cv.etapa === "alterar_horario") {
        const d = e.texto ? lerDataHora(e.texto, agora) : null;
        if (!d) return invalida(pergunta(tel, "Não entendi. Envie o dia e a hora, por exemplo 24/10 07:30."));
        const maxDias = await numero(repo, "antecedencia_maxima_dias", 30);
        if (d.getTime() < agora.getTime() - 60_000) return invalida(pergunta(tel, "Essa data e hora já passaram. Informe uma data e hora futuras."));
        if (d.getTime() > agora.getTime() + maxDias * 86400_000) return invalida(pergunta(tel, `Só é possível agendar até ${maxDias} dias à frente.`));
        campos = { data_hora_prevista: d.toISOString() };
        descricao = `novo horário ${formatarDataHora(d)}`;
      } else if (cv.etapa === "alterar_pax") {
        const n = Number((e.texto ?? "").replace(/\D/g, ""));
        if (!Number.isInteger(n) || n < 1 || n > 15) return invalida(pergunta(tel, "Envie só o número de passageiros, de 1 a 15."));
        campos = { qtd_passageiros: n };
        descricao = `${n} passageiro(s)`;
      } else {
        const l = await lugar("destino");
        if (!l) return invalida(await pDestino());
        campos = { destino: l.texto, destino_lat: l.lat, destino_lng: l.lng };
        descricao = `novo destino ${l.texto}`;
      }
      const r = await alterarCorrida(repo, c, campos, descricao, "bot");
      await encerrarConversa(repo, tel, agora);
      return [...saidas, { para: tel, corridaId: c.id, texto: `Corrida ${c.protocolo} alterada: ${descricao}.${r.saidas.length ? " O fornecedor foi avisado." : ""}` }, ...r.saidas];
    }

    case "cancelar_escolha": {
      // Escolha pela lista (botão ou número da opção) ou pelo protocolo digitado
      const abertas = (await repo.corridasDoSolicitante(sol.id, 20)).filter((x) => CANCELAVEIS_SOLICITANTE.includes(x.status)).slice(0, 10);
      const op = escolha(e, abertas.map((x) => ({ id: `cancelar:${x.id}`, titulo: x.protocolo })));
      const id = op?.startsWith("cancelar:") ? op.slice("cancelar:".length) : null;
      const c = id ? await repo.corrida(id) : e.texto ? await repo.corridaPorProtocolo(e.texto.toUpperCase()) : null;
      if (!c || c.solicitante_id !== sol.id) return invalida(pergunta(tel, "Toque em uma das corridas da lista ou envie o protocolo (ex.: TX-2026-00123)."));
      if (!CANCELAVEIS_SOLICITANTE.includes(c.status)) {
        return menu(c.status === "em_andamento"
          ? `O passageiro da corrida ${c.protocolo} já embarcou, então ela não pode mais ser cancelada. Se houve algum problema, fale com o planejamento.`
          : `A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}" e não pode mais ser cancelada.`);
      }
      return ir("cancelar_motivo", pergunta(tel, `Por que cancelar a corrida ${c.protocolo}?`, OPCOES_MOTIVO_CANCEL), { corrida_id: c.id });
    }

    case "cancelar_motivo": {
      const op = escolha(e, OPCOES_MOTIVO_CANCEL);
      const motivo = op ? op.slice(3) : (e.texto ?? "").length >= 3 ? e.texto! : null;
      if (!motivo) return invalida(pergunta(tel, "Escolha ou escreva o motivo do cancelamento.", OPCOES_MOTIVO_CANCEL));
      const c = await repo.corrida(dados.corrida_id);
      if (!c || !CANCELAVEIS_SOLICITANTE.includes(c.status)) {
        await repo.salvarConversa(tel, "menu", {}, agora);
        return [...saidas, pergunta(tel, c?.status === "em_andamento" ? "O passageiro já embarcou; a corrida não pode mais ser cancelada." : "Essa corrida não pode mais ser cancelada.", MENU)];
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
  // Vários destinos: o mais longe da origem é o final e as paradas vão na ordem de menor km
  // (sem achar todos no mapa, vale a ordem informada e o último é o final)
  type Lugar = { texto: string; lat: number | null; lng: number | null };
  const todos: Lugar[] = [{ texto: d.destino, lat: d.destino_lat ?? null, lng: d.destino_lng ?? null },
    ...(Array.isArray(d.destinos_extras) ? d.destinos_extras : []).slice(0, MAX_DESTINOS - 1)];
  let final = todos[0], paradas: Lugar[] = [];
  if (todos.length > 1) {
    const ot = await repo.otimizarDestinos?.({ texto: d.origem, lat: d.origem_lat ?? null, lng: d.origem_lng ?? null }, todos).catch(() => null);
    const ordem = ot?.ordem ?? [...todos.keys()];
    final = todos[ordem[ordem.length - 1]];
    paradas = ordem.slice(0, -1).map((i) => todos[i]);
  }
  const corrida = await repo.criarCorrida({
    solicitante_id: sol.id, tipo: d.tipo ?? "imediata",
    data_hora_prevista: d.data_hora_prevista ?? agora.toISOString(), origem: d.origem, destino: final.texto,
    origem_lat: d.origem_lat ?? null, origem_lng: d.origem_lng ?? null, destino_lat: final.lat ?? null, destino_lng: final.lng ?? null,
    ...(paradas.length ? { paradas } : {}),
    qtd_passageiros: d.qtd_passageiros ?? 1, outros_passageiros: d.outros_passageiros ?? null, motivo: d.motivo,
    ...(d.observacoes ? { observacoes: d.observacoes } : {}),
  });
  await encerrarConversa(repo, tel, agora);

  const forn = await escolherFornecedor(repo, sol.fornecedor_padrao_id, corrida);
  if (!forn) {
    return [
      { para: tel, corridaId: corrida.id, texto: `Solicitação ${corrida.protocolo} registrada. Não há fornecedor ativo cadastrado; o planejamento foi avisado e vai entrar em contato.` },
      ...await alertar(repo, corrida, "nenhum fornecedor ativo para enviar a corrida"),
    ];
  }
  const { saidas, aprovacao } = await despacharOuSegurar(repo, corrida, forn, agora, "bot");
  if (aprovacao) {
    return [
      { para: tel, corridaId: corrida.id, texto: `Solicitação ${corrida.protocolo} registrada. Antes de ir ao fornecedor, ela precisa da aprovação do planejamento (${aprovacao}). Avisaremos assim que for aprovada.` },
      ...saidas,
    ];
  }
  const resultado: Saida[] = [
    { para: tel, corridaId: corrida.id, texto: `Solicitação ${corrida.protocolo} registrada.${paradas.length ? ` Trajeto: ${trajetoTexto(corrida)}.` : ""} Enviamos ao fornecedor ${forn.nome} e avisaremos quando ele responder.` },
    ...saidas,
  ];
  // O planejamento não recebe aviso de cada corrida registrada (só repetia o pedido); recebe só exceções e alertas
  return resultado;
}

// ---------------------------------------------------------------- Fornecedor

const ACOES_FORNECEDOR = /^(ACEITAR|RECUSAR|CHEGOU|EMBARCOU|NAO_REALIZADA):(.+)$/;

async function fluxoFornecedor(forn: Fornecedor, e: Entrada, repo: Repo, agora: Date): Promise<Saida[]> {
  const tel = e.telefone;
  const responder = (texto: string, opcoes?: Opcao[], corridaId?: string): Saida => ({ para: tel, texto, opcoes, corridaId });
  const m = e.botaoId?.match(ACOES_FORNECEDOR);

  /** Com nome, placa e chegada conferidos: a corrida fica aceita e o solicitante é avisado. */
  const confirmarCorrida = async (c: Corrida, motorista: string, placa: string, chegada: Date, eta: number): Promise<Saida[]> => {
    const campos = { motorista, veiculo_placa: placa, eta_minutos: eta, chegada_prevista_em: chegada.toISOString() };
    const atrasado = c.status === "sem_resposta";
    const atual = c.status === "aceita"
      ? await repo.mudarStatus(c.id, null, "fornecedor", "Dados do motorista atualizados", campos)
      : await repo.mudarStatus(c.id, "aceita", "fornecedor", `${atrasado ? "Aceita depois do prazo" : "Aceita pelo fornecedor"} (chegada ${formatarHora(chegada)})`, campos);
    await repo.salvarConversa(tel, "aguardando", { corrida_id: c.id }, agora);
    const detalhes = `${motorista}, placa ${formatarPlaca(placa)}, ${textoChegada(chegada, agora)}`;
    const alertas = atrasado ? await alertar(repo, atual, "aceita pelo fornecedor depois do prazo") : [];
    // Roteiro do menor trajeto (km e link do Google Maps), antes das opções para não sobrepor os números
    const roteiro = c.status === "aceita" ? null : await repo.roteiro?.(atual).catch(() => null);
    return [
      ...(roteiro ? [responder(roteiro, undefined, c.id)] : []),
      responder(`Corrida ${c.protocolo} confirmada: ${detalhes}. Toque abaixo quando o motorista chegar ao local e quando o passageiro embarcar, ou envie o valor ao final.`,
        [{ id: `CHEGOU:${c.protocolo}`, titulo: "Motorista chegou" }, { id: `EMBARCOU:${c.protocolo}`, titulo: "Passageiro embarcou" }, { id: `NAO_REALIZADA:${c.protocolo}`, titulo: "Não realizada" }], c.id),
      ...await avisarSolicitante(repo, atual, `Sua corrida ${c.protocolo} foi aceita por ${forn.nome}. Motorista: ${detalhes}.`, `aceita por ${forn.nome}. Motorista: ${detalhes}`),
      ...alertas,
    ];
  };

  if (m) {
    const [, acao, ref] = m;
    const c = (await repo.corridaPorProtocolo(ref)) ?? (await repo.corrida(ref));
    if (!c) return [responder("Não encontrei essa corrida.")];
    if (c.fornecedor_id !== forn.id) return [responder(`A corrida ${c.protocolo} foi direcionada a outro fornecedor. Não é preciso fazer nada.`)];
    if (c.status === "cancelada") return [responder(`A corrida ${c.protocolo} foi cancelada. Não é preciso fazer nada.`)];

    if (acao === "ACEITAR") {
      if (!["enviada", "sem_resposta"].includes(c.status)) return [responder(`A corrida ${c.protocolo} já está como "${STATUS[c.status].rotulo}".`)];
      // A corrida só fica aceita quando chegarem motorista, placa e horário de chegada (próxima mensagem)
      await repo.salvarConversa(tel, "motorista", { corrida_id: c.id }, agora);
      const prazo = c.status === "enviada" && c.prazo_resposta_em ? ` Envie até ${formatarHora(new Date(c.prazo_resposta_em))}, senão a corrida passa a outro fornecedor.` : "";
      return [responder(`Para confirmar a corrida ${c.protocolo}, responda três perguntas.${prazo}\n\n1/3 — Qual o nome do motorista?`, undefined, c.id)];
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

    if (acao === "CHEGOU") {
      if (c.status !== "aceita") return [responder(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}".`)];
      if (c.chegou_em) return [responder(`A chegada do motorista na corrida ${c.protocolo} já foi registrada às ${formatarHora(new Date(c.chegou_em))}.`, undefined, c.id)];
      const atual = await repo.mudarStatus(c.id, null, "fornecedor", "Motorista chegou ao local de embarque", { chegou_em: agora.toISOString() });
      await repo.salvarConversa(tel, "aguardando", { corrida_id: c.id }, agora);
      const quem = [atual.motorista, atual.veiculo_placa ? `placa ${formatarPlaca(atual.veiculo_placa)}` : null].filter(Boolean).join(", ");
      return [
        responder(`Chegada registrada às ${formatarHora(agora)}. Toque abaixo quando o passageiro embarcar.`,
          [{ id: `EMBARCOU:${c.protocolo}`, titulo: "Passageiro embarcou" }, { id: `NAO_REALIZADA:${c.protocolo}`, titulo: "Não realizada" }], c.id),
        ...await avisarSolicitante(repo, atual, `Seu motorista chegou ao local de embarque da corrida ${c.protocolo}${quem ? ` (${quem})` : ""}.`, `motorista chegou${quem ? ` (${quem})` : ""}`),
      ];
    }

    if (acao === "EMBARCOU") {
      if (c.status !== "aceita") return [responder(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}".`)];
      await repo.mudarStatus(c.id, "em_andamento", "fornecedor", "Passageiro embarcou");
      await repo.salvarConversa(tel, "valor", { corrida_id: c.id }, agora);
      return [responder(`Embarque da corrida ${c.protocolo} registrado. Ao terminar, envie o valor da corrida (exemplo: 68,50).`, undefined, c.id)];
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

  if ((conv?.etapa === "motorista" || conv?.etapa === "placa" || conv?.etapa === "chegada") && c) {
    if (c.fornecedor_id !== forn.id) {
      await repo.apagarConversa(tel);
      return [responder(`A corrida ${c.protocolo} passou a outro fornecedor porque o prazo de resposta acabou. Não é preciso fazer nada.`)];
    }
    if (!["enviada", "sem_resposta", "aceita"].includes(c.status)) {
      await repo.apagarConversa(tel);
      return [responder(`A corrida ${c.protocolo} está como "${STATUS[c.status].rotulo}". Não é preciso fazer nada.`)];
    }
    const ref = new Date(c.data_hora_prevista);
    const agendada = c.tipo === "agendada";
    const exemploHora = formatarHora(new Date(agora.getTime() + 15 * 60_000));
    const pendente = (texto: string) => [responder(`${texto}\nA corrida ${c.protocolo} só fica confirmada com nome, placa e horário de chegada.`, undefined, c.id)];

    // Trava em três passos: nome → placa válida → horário de chegada válido
    if (conv.etapa === "motorista") {
      // Quem mandar tudo junto ("Carlos Souza, RTX4F21, 17h30") confirma de uma vez
      const tudo = lerDadosMotorista(e.texto ?? "", agora, ref, agendada);
      if (tudo.dados) return confirmarCorrida(c, tudo.dados.motorista, tudo.dados.veiculo_placa, tudo.dados.chegada, tudo.dados.eta_minutos);
      const nome = nomeValido(e.texto);
      if (!nome) return pendente("Envie só o nome do motorista, sem números (exemplo: Carlos Souza).");
      await repo.salvarConversa(tel, "placa", { corrida_id: c.id, motorista: nome }, agora);
      return [responder(`Motorista: ${nome}.\n\n2/3 — Qual a placa do carro? (padrão antigo ABC1234 ou Mercosul ABC1D23)`, undefined, c.id)];
    }
    if (conv.etapa === "placa") {
      const placa = placaValida(e.texto);
      if (!placa) return pendente(`"${(e.texto ?? "").trim()}" não é uma placa válida. Use 7 caracteres no padrão antigo (ABC1234) ou Mercosul (ABC1D23).`);
      await repo.salvarConversa(tel, "chegada", { ...conv.dados, veiculo_placa: placa }, agora);
      return [responder(`Placa: ${formatarPlaca(placa)}.\n\n3/3 — Que horas o motorista chega? (exemplo: ${exemploHora})`, undefined, c.id)];
    }
    const chegada = lerHorarioChegada(e.texto ?? "", agora, ref, agendada);
    if ("erro" in chegada) return pendente(`Horário inválido: ${chegada.erro}. Envie o horário de chegada (exemplo: ${exemploHora}).`);
    return confirmarCorrida(c, String(conv.dados.motorista), String(conv.dados.veiculo_placa), chegada.em, chegada.minutos);
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
      ...await pedirAvaliacao(repo, atual, agora),
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
