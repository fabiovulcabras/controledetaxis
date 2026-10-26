import { describe, expect, it } from "vitest";
import { processarEntrada, lerMotorista, contemPalavra } from "../lib/bot/motor";
import { despachar, enviarLembretes, verificarPrazos, proximoFornecedor, tratarPrazoVencido, valorEsperado, verificarValor } from "../lib/bot/acoes";
import { lerWebhookEvolution, textoComOpcoes, traduzirResposta } from "../lib/whatsapp/evolution";
import { assinaturaQStashValida } from "../lib/qstash";
import { linkWhatsApp, msgNovaCorridaFornecedor, msgAceitaSolicitante } from "../lib/whatsapp/link";
import { lerDataHora, lerValor, formatarDataHora, dataSP } from "../lib/datas";
import { normalizarTelefone, variantesTelefone } from "../lib/telefone";
import { repoExemplo } from "./repo-memoria";
import { lerFaturaCsv, lerFaturaLinhas } from "../lib/csv";
import { gerarXlsx } from "../lib/xlsx";
import { lerPlanilhaXlsx } from "../lib/xlsx-leitura";
import { enderecoDoNominatim, sugestoesDoPhoton } from "../lib/endereco";
import type { Entrada, Saida } from "../lib/bot/tipos";

const ANA = "5511900000001";
const RTC = "5511900000101";
const PLAN = "5511900000900";
const inicio = dataSP(2026, 10, 23, 9, 20);
const min = (n: number) => new Date(inicio.getTime() + n * 60_000);

function conversa(repo = repoExemplo()) {
  let relogio = 0;
  const enviar = async (e: Entrada, minutos = 1) => { relogio += minutos; return processarEntrada(e, repo, min(relogio)); };
  return { repo, enviar, agora: () => min(relogio) };
}
const para = (s: Saida[], tel: string) => s.filter((x) => x.para === tel);
const ultima = (s: Saida[], tel: string) => para(s, tel).at(-1)!;

async function pedirTaxiCompleto(c: ReturnType<typeof conversa>) {
  await c.enviar({ telefone: ANA, texto: "oi" });
  await c.enviar({ telefone: ANA, botaoId: "pedir" });
  await c.enviar({ telefone: ANA, botaoId: "agora" });
  await c.enviar({ telefone: ANA, botaoId: "origem_unidade" });
  await c.enviar({ telefone: ANA, texto: "Aeroporto de Guarulhos, Terminal 2" });
  await c.enviar({ telefone: ANA, botaoId: "pax:1" });
  await c.enviar({ telefone: ANA, botaoId: "cc:cc1" });
  await c.enviar({ telefone: ANA, botaoId: "motivo:Visita a cliente" });
  return c.enviar({ telefone: ANA, botaoId: "confirmar" });
}

describe("solicitação pelo WhatsApp", () => {
  it("primeira mensagem mostra o menu com o nome", async () => {
    const c = conversa();
    const s = await c.enviar({ telefone: ANA, texto: "Bom dia" });
    expect(s).toHaveLength(1);
    expect(s[0].texto).toContain("Olá, Ana");
    expect(s[0].opcoes?.map((o) => o.id)).toEqual(["pedir", "minhas", "cancelar"]);
  });

  it("fluxo completo gera protocolo, envia ao fornecedor e avisa o planejamento", async () => {
    const c = conversa();
    const s = await pedirTaxiCompleto(c);
    const corrida = c.repo.corridas[0];
    expect(corrida.protocolo).toBe("TX-2026-00001");
    expect(corrida.status).toBe("enviada");
    expect(corrida.fornecedor_id).toBe("f1");
    expect(corrida.origem).toContain("R. das Indústrias");
    expect(corrida.destino).toBe("Aeroporto de Guarulhos, Terminal 2");
    expect(corrida.prazo_resposta_em).toBe(min(9 + 10).toISOString());
    expect(ultima(s, ANA).texto).toContain("TX-2026-00001 registrada");
    const forn = ultima(s, RTC);
    expect(forn.template?.nome).toBe("nova_corrida_fornecedor");
    expect(forn.template?.sempre).toBe(true);
    expect(forn.template?.botoes).toEqual(["ACEITAR:TX-2026-00001", "RECUSAR:TX-2026-00001"]);
    expect(ultima(s, PLAN).template?.nome).toBe("nova_corrida_planejamento");
  });

  it("resumo antes de confirmar mostra os dados escolhidos", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, texto: "1" });
    await c.enviar({ telefone: ANA, texto: "agendar" });
    await c.enviar({ telefone: ANA, texto: "amanhã 7h30" });
    await c.enviar({ telefone: ANA, texto: "Rua Augusta, 88" });
    await c.enviar({ telefone: ANA, botaoId: "destino_unidade" });
    await c.enviar({ telefone: ANA, botaoId: "pax:2" });
    await c.enviar({ telefone: ANA, texto: "Marcos Lima" });
    await c.enviar({ telefone: ANA, texto: "cc 2300" });
    const s = await c.enviar({ telefone: ANA, texto: "Reunião com fornecedor" });
    expect(s[0].texto).toContain("Quando: 24/10 07:30");
    expect(s[0].texto).toContain("Passageiros: 2 (Marcos Lima)");
    expect(s[0].texto).toContain("CC 2300 · Comercial");
    expect(s[0].texto).toContain("Motivo: Reunião com fornecedor");
    expect(s[0].opcoes?.map((o) => o.id)).toEqual(["confirmar", "corrigir", "descartar"]);
  });

  it("corrida agendada usa o prazo de resposta das agendadas", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, texto: "25/10 18:00" });
    await c.enviar({ telefone: ANA, botaoId: "origem_unidade" });
    await c.enviar({ telefone: ANA, texto: "Rodoviária Tietê" });
    await c.enviar({ telefone: ANA, texto: "1" });
    await c.enviar({ telefone: ANA, botaoId: "cc:cc1" });
    await c.enviar({ telefone: ANA, texto: "Hora extra" });
    await c.enviar({ telefone: ANA, botaoId: "confirmar" });
    const corrida = c.repo.corridas[0];
    expect(corrida.tipo).toBe("agendada");
    expect(formatarDataHora(corrida.data_hora_prevista)).toBe("25/10 18:00");
    expect(corrida.prazo_resposta_em).toBe(min(9 + 120).toISOString());
  });

  it("data no passado é recusada e a pergunta se repete", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, botaoId: "agendar" });
    const s = await c.enviar({ telefone: ANA, texto: "22/10 08:00" });
    expect(s[0].texto).toContain("Só é possível agendar");
    const s2 = await c.enviar({ telefone: ANA, texto: "hoje 08:00" });
    expect(s2[0].texto).toContain("já passaram");
  });

  it("três respostas não entendidas voltam ao menu", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, texto: "???" });
    await c.enviar({ telefone: ANA, texto: "???" });
    const s = await c.enviar({ telefone: ANA, texto: "???" });
    expect(s[0].texto).toContain("Não consegui entender");
    expect(c.repo.conversas.get(ANA)?.etapa).toBe("menu");
  });

  it("conversa parada por mais de 15 minutos é descartada", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    const s = await c.enviar({ telefone: ANA, texto: "agora" }, 30);
    expect(s[0].texto).toContain("foi descartada");
    expect(s[1].opcoes?.[0].id).toBe("pedir");
  });

  it("localização enviada vira origem com coordenadas", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, botaoId: "agora" });
    await c.enviar({ telefone: ANA, localizacao: { lat: -23.5, lng: -46.6, endereco: "Av. Paulista, 1000" } });
    expect(c.repo.conversas.get(ANA)?.dados.origem).toBe("Av. Paulista, 1000");
    expect(c.repo.conversas.get(ANA)?.dados.origem_lat).toBe(-23.5);
  });

  it("minhas corridas lista o status", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const s = await c.enviar({ telefone: ANA, botaoId: "minhas" });
    expect(s[0].texto).toContain("TX-2026-00001");
    expect(s[0].texto).toContain("Aguardando fornecedor");
  });

  it("cancelar pelo bot avisa o fornecedor", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: ANA, botaoId: "cancelar" });
    const s1 = await c.enviar({ telefone: ANA, botaoId: "cancelar:c1" });
    expect(s1[0].texto).toContain("Por que cancelar");
    const s = await c.enviar({ telefone: ANA, botaoId: "mc:Não preciso mais" });
    expect(c.repo.corridas[0].status).toBe("cancelada");
    expect(c.repo.corridas[0].motivo_cancelamento).toBe("Não preciso mais");
    expect(ultima(s, ANA).texto).toContain("O fornecedor foi avisado");
    expect(ultima(s, RTC).template?.nome).toBe("corrida_cancelada_fornecedor");
  });

  it("número não cadastrado é recusado e o planejamento é avisado uma vez por dia", async () => {
    const c = conversa();
    const s = await c.enviar({ telefone: "5521980007766", texto: "quero um táxi" });
    expect(s[0].texto).toContain("não está autorizado");
    expect(ultima(s, PLAN).template?.nome).toBe("alerta_corrida_planejamento");
    const s2 = await c.enviar({ telefone: "5521980007766", texto: "oi?" });
    expect(para(s2, PLAN)).toHaveLength(0);
  });

  it("aceita número sem o nono dígito, como o WhatsApp às vezes envia", async () => {
    const c = conversa();
    c.repo.solicitantes.push({ id: "s2", nome: "Bruna Costa", telefone_whatsapp: "5511988124471", unidade_id: "u1", ativo: true });
    const s = await c.enviar({ telefone: "551188124471", texto: "oi" });
    expect(s[0].texto).toContain("Olá, Bruna");
  });
});

describe("respostas do fornecedor", () => {
  it("aceite, dados do motorista, embarque e valor", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const s1 = await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("aceita");
    expect(s1[0].texto).toContain("Informe motorista");

    const s2 = await c.enviar({ telefone: RTC, texto: "Carlos Souza, RTX-4F21, 12 min" });
    expect(c.repo.corridas[0].motorista).toBe("Carlos Souza");
    expect(c.repo.corridas[0].veiculo_placa).toBe("RTX4F21");
    expect(c.repo.corridas[0].eta_minutos).toBe(12);
    expect(ultima(s2, ANA).texto).toContain("foi aceita por Rádio Táxi Central");
    expect(ultima(s2, ANA).template?.nome).toBe("atualizacao_corrida_solicitante");
    expect(ultima(s2, RTC).opcoes?.map((o) => o.id)).toEqual(["EMBARCOU:TX-2026-00001", "NAO_REALIZADA:TX-2026-00001"]);

    await c.enviar({ telefone: RTC, botaoId: "EMBARCOU:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("em_andamento");
    const s4 = await c.enviar({ telefone: RTC, texto: "R$ 68,50" });
    expect(c.repo.corridas[0].status).toBe("concluida");
    expect(c.repo.corridas[0].valor_informado).toBe(68.5);
    expect(s4[0].texto).toContain("R$");
    expect(para(s4, PLAN)).toHaveLength(0);
  });

  it("valor acima do teto do centro de custo alerta o planejamento", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    await c.enviar({ telefone: RTC, texto: "Paulo Reis FHK2B90 5min" });
    const s = await c.enviar({ telefone: RTC, texto: "210" });
    expect(c.repo.corridas[0].status).toBe("concluida");
    expect(ultima(s, PLAN).texto).toContain("acima do teto");
  });

  it("recusa avisa o solicitante e o planejamento", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const s = await c.enviar({ telefone: RTC, botaoId: "RECUSAR:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("recusada");
    expect(ultima(s, ANA).texto).toContain("não atendeu");
    expect(ultima(s, PLAN).texto).toContain("recusada pelo fornecedor");
  });

  it("botão de corrida cancelada ou de outro fornecedor não muda nada", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const outro = await c.enviar({ telefone: "5511900000102", botaoId: "ACEITAR:TX-2026-00001" });
    expect(outro[0].texto).toContain("outro fornecedor");
    await c.enviar({ telefone: ANA, botaoId: "cancelar" });
    await c.enviar({ telefone: ANA, botaoId: "cancelar:c1" });
    await c.enviar({ telefone: ANA, texto: "Mudou a reunião" });
    const s = await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    expect(s[0].texto).toContain("foi cancelada");
    expect(c.repo.corridas[0].status).toBe("cancelada");
  });

  it("cancelar depois do aceite alerta o planejamento", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    await c.enviar({ telefone: ANA, texto: "menu" });
    await c.enviar({ telefone: ANA, botaoId: "cancelar" });
    await c.enviar({ telefone: ANA, botaoId: "cancelar:c1" });
    const s = await c.enviar({ telefone: ANA, botaoId: "mc:Mudou o horário" });
    expect(ultima(s, PLAN).texto).toContain("cancelada depois do aceite");
  });

  it("não realizada cancela e avisa", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    await c.enviar({ telefone: RTC, texto: "Carlos, RTX4F21, 10 min" });
    const s = await c.enviar({ telefone: RTC, botaoId: "NAO_REALIZADA:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("cancelada");
    expect(ultima(s, ANA).texto).toContain("não foi realizada");
  });
});

describe("agendador", () => {
  it("prazo vencido vira Sem resposta e o fornecedor ainda pode aceitar depois", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const s = await verificarPrazos(c.repo, min(30));
    expect(c.repo.corridas[0].status).toBe("sem_resposta");
    expect(ultima(s, PLAN).texto).toContain("sem resposta");
    expect(ultima(s, ANA).texto).toContain("ainda não respondeu");
    expect(await verificarPrazos(c.repo, min(31))).toHaveLength(0);
    const tarde = await processarEntrada({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" }, c.repo, min(32));
    expect(c.repo.corridas[0].status).toBe("aceita");
    expect(ultima(tarde, PLAN).texto).toContain("depois do prazo");
  });

  it("lembrete sai uma vez antes da corrida agendada", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, texto: "hoje 11:00" });
    await c.enviar({ telefone: ANA, botaoId: "origem_unidade" });
    await c.enviar({ telefone: ANA, texto: "Cliente Moda Norte" });
    await c.enviar({ telefone: ANA, botaoId: "pax:1" });
    await c.enviar({ telefone: ANA, botaoId: "cc:cc1" });
    await c.enviar({ telefone: ANA, botaoId: "motivo:Visita a cliente" });
    await c.enviar({ telefone: ANA, botaoId: "confirmar" });
    c.repo.parametros.lembrete_antecedencia_min = "60";
    expect(await enviarLembretes(c.repo, min(20))).toHaveLength(0);
    const s = await enviarLembretes(c.repo, min(45));
    expect(s[0].template?.nome).toBe("lembrete_corrida_solicitante");
    expect(await enviarLembretes(c.repo, min(50))).toHaveLength(0);
  });
});

describe("leitura de textos", () => {
  const agora = dataSP(2026, 10, 23, 9, 20);
  it("datas", () => {
    expect(formatarDataHora(lerDataHora("24/10 07:30", agora)!)).toBe("24/10 07:30");
    expect(formatarDataHora(lerDataHora("amanhã às 7h", agora)!)).toBe("24/10 07:00");
    expect(formatarDataHora(lerDataHora("hoje 18h40", agora)!)).toBe("23/10 18:40");
    expect(formatarDataHora(lerDataHora("05/01 06:00", agora)!)).toBe("05/01 06:00");
    expect(lerDataHora("05/01 06:00", agora)!.getUTCFullYear()).toBe(2027);
    expect(lerDataHora("31/02 10:00", agora)).toBeNull();
    expect(lerDataHora("qualquer coisa", agora)).toBeNull();
  });
  it("valores", () => {
    expect(lerValor("68,50")).toBe(68.5);
    expect(lerValor("R$ 1.250,00")).toBe(1250);
    expect(lerValor("68.5")).toBe(68.5);
    expect(lerValor("sessenta")).toBeNull();
  });
  it("motorista", () => {
    expect(lerMotorista("Carlos Souza, RTX4F21, 12 min")).toEqual({ motorista: "Carlos Souza", veiculo_placa: "RTX4F21", eta_minutos: 12 });
    expect(lerMotorista("motorista João placa abc-1234 chega em 8 minutos")).toEqual({ motorista: "João", veiculo_placa: "ABC1234", eta_minutos: 8 });
  });
  it("telefones", () => {
    expect(normalizarTelefone("(11) 98812-4471")).toBe("5511988124471");
    expect(normalizarTelefone("551188124471")).toBe("5511988124471");
    expect(variantesTelefone("5511988124471")).toContain("551188124471");
  });
});

describe("fatura em CSV", () => {
  it("lê com cabeçalho, separador ; e valores em reais", () => {
    const { itens, erros } = lerFaturaCsv("Data;Protocolo;Descrição;Valor\n19/10/2026;tx-2026-00012;Centro → GRU;\"1.250,00\"\n20/10/2026;;Corrida avulsa;48,00\n21/10/2026;TX-2026-00013;x;abc");
    expect(itens).toHaveLength(2);
    expect(itens[0]).toEqual({ data_corrida: "2026-10-19", protocolo_informado: "TX-2026-00012", descricao: "Centro → GRU", valor: 1250 });
    expect(itens[1].protocolo_informado).toBeNull();
    expect(erros).toHaveLength(1);
  });
  it("lê sem cabeçalho na ordem data, protocolo, descrição, valor", () => {
    const { itens } = lerFaturaCsv("2026-10-22,TX-2026-00020,Rodoviária,54.00");
    expect(itens[0]).toEqual({ data_corrida: "2026-10-22", protocolo_informado: "TX-2026-00020", descricao: "Rodoviária", valor: 54 });
  });
});

describe("links do WhatsApp (wa.me)", () => {
  it("monta o link com o número normalizado e o texto codificado", () => {
    expect(linkWhatsApp("(11) 98812-4471", "Olá & tchau")).toBe("https://wa.me/5511988124471?text=Ol%C3%A1%20%26%20tchau");
  });
  it("mensagem ao fornecedor traz protocolo e o link de resposta", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const corrida = c.repo.corridas[0];
    const msg = msgNovaCorridaFornecedor(corrida, "Ana Ribeiro", "https://app.exemplo");
    expect(msg).toContain("TX-2026-00001");
    expect(msg).toContain("https://app.exemplo/f/tok1");
    expect(msg).toContain("Origem: Unidade Centro");
  });
  it("aviso de aceite ao solicitante traz motorista e link de acompanhamento", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    await c.enviar({ telefone: RTC, texto: "Carlos Souza, RTX4F21, 12 min" });
    const msg = msgAceitaSolicitante(c.repo.corridas[0], "Rádio Táxi Central", "https://app.exemplo", "abc");
    expect(msg).toContain("Motorista: Carlos Souza, placa RTX4F21, chega em cerca de 12 min.");
    expect(msg).toContain("https://app.exemplo/pedir/abc");
  });
  it("reenviar a outro fornecedor troca o link; reenviar ao mesmo mantém", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "RECUSAR:TX-2026-00001" });
    const antes = c.repo.corridas[0].token_fornecedor;
    const outro = c.repo.fornecedores[1];
    await despachar(c.repo, c.repo.corridas[0], outro, min(60), "planejamento");
    const depois = c.repo.corridas[0].token_fornecedor;
    expect(depois === antes).toBe(false);
    expect(depois!.length).toBe(64);
    await despachar(c.repo, c.repo.corridas[0], outro, min(61), "planejamento");
    expect(c.repo.corridas[0].token_fornecedor).toBe(depois);
  });
});

describe("endereço pela localização", () => {
  it("monta rua, número, bairro, cidade e UF", () => {
    const r = { display_name: "x", address: { road: "Rua das Indústrias", house_number: "450", suburb: "Centro", town: "Extrema", "ISO3166-2-lvl4": "BR-MG" } };
    expect(enderecoDoNominatim(r)).toBe("Rua das Indústrias, 450 - Centro, Extrema - MG");
  });
  it("sem número nem bairro, usa o que houver", () => {
    expect(enderecoDoNominatim({ address: { road: "Rodovia Fernão Dias", city: "Extrema", "ISO3166-2-lvl4": "BR-MG" } })).toBe("Rodovia Fernão Dias, Extrema - MG");
  });
  it("sem campos estruturados, usa o nome completo", () => {
    expect(enderecoDoNominatim({ display_name: "Algum lugar, Brasil", address: {} })).toBe("Algum lugar, Brasil");
  });
  it("mensagem ao fornecedor inclui o mapa quando há coordenadas", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const corrida = { ...c.repo.corridas[0], origem_lat: -22.83396, origem_lng: -46.328 };
    expect(msgNovaCorridaFornecedor(corrida, "Ana", "https://app")).toContain("Mapa: https://maps.google.com/?q=-22.83396,-46.328");
  });
});

describe("sugestões de endereço", () => {
  it("formata, converte o estado em UF e remove repetidas", () => {
    const geo = { features: [
      { geometry: { coordinates: [-46.32, -22.85] }, properties: { street: "Rua das Indústrias", housenumber: "450", district: "Centro", city: "Extrema", state: "Minas Gerais" } },
      { geometry: { coordinates: [-46.32, -22.85] }, properties: { street: "Rua das Indústrias", housenumber: "450", district: "Centro", city: "Extrema", state: "Minas Gerais" } },
      { geometry: { coordinates: [-46.47, -23.43] }, properties: { name: "Aeroporto Internacional de Guarulhos", city: "Guarulhos", state: "São Paulo" } },
      { geometry: { coordinates: [] }, properties: { name: "Sem coordenadas" } },
    ] };
    const s = sugestoesDoPhoton(geo);
    expect(s).toHaveLength(2);
    expect(s[0].endereco).toBe("Rua das Indústrias, 450 - Centro, Extrema - MG");
    expect(s[0].lat).toBe(-22.85);
    expect(s[1].endereco).toBe("Aeroporto Internacional de Guarulhos, Guarulhos - SP");
  });
});

describe("reenvio automático e conferência de valor", () => {
  it("recusa passa a corrida ao próximo fornecedor quando ligado", async () => {
    const c = conversa();
    c.repo.parametros.reenvio_automatico = "sim";
    await pedirTaxiCompleto(c);
    const s = await c.enviar({ telefone: RTC, botaoId: "RECUSAR:TX-2026-00001" });
    const corrida = c.repo.corridas[0];
    expect(corrida.status).toBe("enviada");
    expect(corrida.fornecedor_id).toBe("f2");
    expect(corrida.fornecedores_tentados).toEqual(["f1", "f2"]);
    expect(ultima(s, "5511900000102").template?.nome).toBe("nova_corrida_fornecedor");
    expect(ultima(s, ANA).texto).toContain("Enviamos a Coop Táxi Express");
    expect(para(s, PLAN)).toHaveLength(0);
  });
  it("sem fornecedor sobrando, a recusa vai para o planejamento", async () => {
    const c = conversa();
    c.repo.parametros.reenvio_automatico = "sim";
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "RECUSAR:TX-2026-00001" });
    const s = await c.enviar({ telefone: "5511900000102", botaoId: "RECUSAR:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("recusada");
    expect(ultima(s, PLAN).texto).toContain("recusada pelo fornecedor");
    expect(await proximoFornecedor(c.repo, c.repo.corridas[0])).toBeNull();
  });
  it("prazo vencido com reenvio (API oficial) tenta o próximo fornecedor", async () => {
    const c = conversa();
    c.repo.parametros.reenvio_automatico = "sim";
    await pedirTaxiCompleto(c);
    const s = await verificarPrazos(c.repo, min(30), { reenviar: true });
    expect(c.repo.corridas[0].status).toBe("enviada");
    expect(c.repo.corridas[0].fornecedor_id).toBe("f2");
    expect(ultima(s, ANA).texto).toContain("Enviamos a Coop Táxi Express");
  });
  it("valor esperado pela tarifa e alerta acima da tolerância", async () => {
    const c = conversa();
    await pedirTaxiCompleto(c);
    const corrida = c.repo.corridas[0];
    Object.assign(corrida, { fornecedor_id: "f2", distancia_km: 10 });
    expect(valorEsperado(corrida, c.repo.fornecedores[1])).toBe(36);
    c.repo.parametros.tolerancia_trajeto_pct = "30";
    expect(await verificarValor(c.repo, corrida, 45, min(20))).toHaveLength(0);
    const s = await verificarValor(c.repo, corrida, 60, min(20));
    expect(ultima(s, PLAN).texto).toContain("acima do esperado para 10.0 km");
  });
  it("limite mensal da pessoa gera alerta", async () => {
    const c = conversa();
    c.repo.solicitantes[0].limite_mensal = 50;
    await pedirTaxiCompleto(c);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    await c.enviar({ telefone: RTC, texto: "Carlos, RTX4F21, 5 min" });
    const s = await c.enviar({ telefone: RTC, texto: "80" });
    expect(para(s, PLAN).some((x) => x.texto.includes("passou do limite mensal"))).toBe(true);
  });
});

describe("fatura em Excel (.xlsx)", () => {
  it("lê de volta uma planilha gerada pelo próprio app", async () => {
    const partes = gerarXlsx("Fatura", [{ titulo: "Data" }, { titulo: "Protocolo" }, { titulo: "Descrição" }, { titulo: "Valor", formato: "moeda" }],
      [["19/10/2026", "TX-2026-00012", "Centro & GRU", 142.5], [46315, "tx-2026-00013", "Rodoviária", 54]]);
    const total = partes.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total); let o = 0;
    for (const p of partes) { buf.set(p, o); o += p.length; }
    const linhas = await lerPlanilhaXlsx(buf.buffer);
    expect(linhas[0]).toEqual(["Data", "Protocolo", "Descrição", "Valor"]);
    const { itens } = lerFaturaLinhas(linhas);
    expect(itens).toHaveLength(2);
    expect(itens[0]).toEqual({ data_corrida: "2026-10-19", protocolo_informado: "TX-2026-00012", descricao: "Centro & GRU", valor: 142.5 });
    expect(itens[1].data_corrida).toBe("2026-10-20");
    expect(itens[1].protocolo_informado).toBe("TX-2026-00013");
  });
});

describe("Evolution API e fila com prazo (QStash)", () => {
  const evento = (data: unknown) => ({ event: "messages.upsert", instance: "taxis", data });

  it("lê texto, localização e ignora mensagens próprias, grupos e figurinhas", () => {
    const r = lerWebhookEvolution({ event: "MESSAGES_UPSERT", data: [
      { key: { remoteJid: "5511900000101@s.whatsapp.net", fromMe: false, id: "A1" }, pushName: "RTC", message: { conversation: "1" } },
      { key: { remoteJid: "5511900000001@s.whatsapp.net", fromMe: false, id: "A2" }, message: { extendedTextMessage: { text: "Rua Augusta, 88" } } },
      { key: { remoteJid: "5511900000001@s.whatsapp.net", fromMe: false, id: "A3" }, message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, address: "Av. Paulista" } } },
      { key: { remoteJid: "5511900000001@s.whatsapp.net", fromMe: true, id: "A4" }, message: { conversation: "eco" } },
      { key: { remoteJid: "1203630@g.us", fromMe: false, id: "A5" }, message: { conversation: "grupo" } },
      { key: { remoteJid: "5511900000001@s.whatsapp.net", fromMe: false, id: "A6" }, message: { stickerMessage: {} } },
      { key: { remoteJid: "98765@lid", senderPn: "5511900000002@s.whatsapp.net", fromMe: false, id: "A7" }, message: { conversation: "oi" } },
    ] });
    expect(r.map((m) => m.waId)).toEqual(["A1", "A2", "A3", "A7"]);
    expect(r[0].entrada).toEqual({ telefone: "5511900000101", texto: "1" });
    expect(r[2].entrada.localizacao).toEqual({ lat: -23.5, lng: -46.6, endereco: "Av. Paulista", nome: undefined });
    expect(r[3].entrada.telefone).toBe("5511900000002");
    expect(lerWebhookEvolution(evento({ key: { remoteJid: "5511900000101@s.whatsapp.net", id: "B1" }, message: { conversation: "2" } }))).toHaveLength(1);
    expect(lerWebhookEvolution({ event: "connection.update", data: {} })).toEqual([]);
  });

  it("opções vão numeradas e a resposta numérica vira a opção", () => {
    const opcoes = [{ id: "ACEITAR:TX-1", titulo: "Aceitar" }, { id: "RECUSAR:TX-1", titulo: "Recusar" }];
    expect(textoComOpcoes({ texto: "Nova corrida", opcoes })).toBe("Nova corrida\n\nResponda com o número:\n*1* – Aceitar\n*2* – Recusar");
    expect(traduzirResposta("1", opcoes)).toBe("ACEITAR:TX-1");
    expect(traduzirResposta(" 2. ", opcoes)).toBe("RECUSAR:TX-1");
    expect(traduzirResposta("opção 1", opcoes)).toBe("ACEITAR:TX-1");
    expect(traduzirResposta("3", opcoes)).toBeNull();
    expect(traduzirResposta("68,50", opcoes)).toBeNull();
    expect(traduzirResposta("1", null)).toBeNull();
  });

  it("fornecedor digita 1 e aceita; o solicitante recebe a confirmação depois dos dados do motorista", async () => {
    const c = conversa();
    const s = await pedirTaxiCompleto(c);
    const msg = ultima(s, RTC);
    const resposta = traduzirResposta("1", msg.opcoes);
    expect(resposta).toBe("ACEITAR:TX-2026-00001");
    await c.enviar({ telefone: RTC, texto: "1", botaoId: resposta! });
    expect(c.repo.corridas[0].status).toBe("aceita");
    const s2 = await c.enviar({ telefone: RTC, texto: "Carlos Souza, RTX4F21, 12 min" });
    expect(ultima(s2, ANA).texto).toContain("foi aceita por");
  });

  it("prazo vencido: o fornecedor perde a vez e a corrida vai ao próximo da fila", async () => {
    const c = conversa();
    c.repo.parametros.reenvio_automatico = "sim";
    await pedirTaxiCompleto(c);
    const corrida = c.repo.corridas[0];
    const s = await tratarPrazoVencido(c.repo, corrida, min(30), { reenviar: true });
    const atual = c.repo.corridas[0];
    expect(atual.status).toBe("enviada");
    expect(atual.fornecedor_id).toBe("f2");
    expect(atual.fornecedores_tentados).toEqual(["f1", "f2"]);
    expect(ultima(s, "5511900000102").opcoes?.map((o) => o.titulo)).toEqual(["Aceitar", "Recusar"]);
    expect(ultima(s, ANA).texto).toContain("não respondeu");
    // O 1º fornecedor responde "1" tarde demais: a corrida já é de outro
    const tarde = await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" }, 25);
    expect(ultima(tarde, RTC).texto).toContain("outro fornecedor");
    // O 2º também não responde: sem ninguém na fila, o planejamento é alertado
    const fim = await tratarPrazoVencido(c.repo, c.repo.corridas[0], min(60), { reenviar: true });
    expect(c.repo.corridas[0].status).toBe("sem_resposta");
    expect(ultima(fim, PLAN).texto).toContain("nenhum outro fornecedor");
  });

  it("aceita só a assinatura do QStash com chave e corpo certos", async () => {
    const b64 = (t: string | Uint8Array) => {
      const u8 = typeof t === "string" ? new TextEncoder().encode(t) : t;
      let x = ""; for (const b of u8) x += String.fromCharCode(b);
      return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const corpo = JSON.stringify({ tentativa_id: "4f7d5c1e-8a6b-4c5d-9e0f-1a2b3c4d5e6f" });
    const agora = Date.UTC(2026, 9, 26, 12, 0, 0);
    const hash = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(corpo))));
    const assinar = async (chave: string, body = hash, exp = agora / 1000 + 300) => {
      const cab = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const carga = b64(JSON.stringify({ iss: "Upstash", sub: "https://app/api/qstash/prazo", exp, nbf: agora / 1000 - 10, body }));
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return `${cab}.${carga}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${cab}.${carga}`))))}`;
    };
    expect(await assinaturaQStashValida(await assinar("atual"), corpo, ["atual", "proxima"], agora)).toBe(true);
    expect(await assinaturaQStashValida(await assinar("proxima"), corpo, ["atual", "proxima"], agora)).toBe(true);
    expect(await assinaturaQStashValida(await assinar("outra"), corpo, ["atual", "proxima"], agora)).toBe(false);
    expect(await assinaturaQStashValida(await assinar("atual"), corpo + " ", ["atual", "proxima"], agora)).toBe(false);
    expect(await assinaturaQStashValida(await assinar("atual", hash, agora / 1000 - 600), corpo, ["atual"], agora)).toBe(false);
    expect(await assinaturaQStashValida(null, corpo, ["atual"], agora)).toBe(false);
  });
});

describe("localização enviada pelo WhatsApp", () => {
  it("usa o endereço escrito e mantém o nome do local escolhido no mapa", async () => {
    const c = conversa();
    await c.enviar({ telefone: ANA, texto: "oi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, botaoId: "agora" });
    await c.enviar({ telefone: ANA, localizacao: { lat: -22.85, lng: -46.31, endereco: "Rua A, 10 - Centro, Extrema - MG" } });
    await c.enviar({ telefone: ANA, localizacao: { lat: -22.86, lng: -46.32, nome: "Pronto Socorro Municipal", endereco: "Rua B, 20 - Centro, Extrema - MG" } });
    const conv = await c.repo.conversa(ANA);
    expect(conv?.dados.origem).toBe("Rua A, 10 - Centro, Extrema - MG");
    expect(conv?.dados.origem_lat).toBe(-22.85);
    expect(conv?.dados.destino).toBe("Pronto Socorro Municipal – Rua B, 20 - Centro, Extrema - MG");
  });
});

describe("palavra de ativação", () => {
  it("reconhece a palavra inteira, sem acento nem maiúscula", () => {
    expect(contemPalavra("Preciso de um TÁXI agora", ["taxi"])).toBe(true);
    expect(contemPalavra("táxi", ["taxi", "corrida"])).toBe(true);
    expect(contemPalavra("quero uma corrida", ["taxi", "corrida"])).toBe(true);
    expect(contemPalavra("o taxista chegou", ["taxi"])).toBe(false);
    expect(contemPalavra("oi, tudo bem?", ["taxi"])).toBe(false);
  });

  it("ignora conversa comum e só começa com a palavra; a conversa segue sem repetir a palavra", async () => {
    const c = conversa();
    c.repo.parametros.palavra_ativacao = "taxi";
    expect(await c.enviar({ telefone: ANA, texto: "oi, tudo bem?" })).toEqual([]);
    expect(await c.enviar({ telefone: "5511988887777", texto: "boa tarde" })).toEqual([]); // número desconhecido também
    const s = await c.enviar({ telefone: ANA, texto: "Preciso de um táxi" });
    expect(s[0].opcoes?.map((o) => o.id)).toEqual(["pedir", "minhas", "cancelar"]);
    await c.enviar({ telefone: ANA, texto: "1" });
    await c.enviar({ telefone: ANA, botaoId: "agora" });
    await c.enviar({ telefone: ANA, botaoId: "origem_unidade" });
    await c.enviar({ telefone: ANA, texto: "Aeroporto de Guarulhos, Terminal 2" });
    await c.enviar({ telefone: ANA, botaoId: "pax:1" });
    await c.enviar({ telefone: ANA, botaoId: "cc:cc1" });
    await c.enviar({ telefone: ANA, botaoId: "motivo:Visita a cliente" });
    const fim = await c.enviar({ telefone: ANA, botaoId: "confirmar" });
    expect(ultima(fim, ANA).texto).toContain("registrada");
    // Pedido feito: a conversa acaba e um "obrigado" não aciona o bot
    expect(await c.enviar({ telefone: ANA, texto: "obrigado!" })).toEqual([]);
  });

  it("fornecedor responde à corrida sem a palavra, mas conversa comum dele é ignorada", async () => {
    const c = conversa();
    c.repo.parametros.palavra_ativacao = "taxi";
    await c.enviar({ telefone: ANA, texto: "taxi" });
    await c.enviar({ telefone: ANA, botaoId: "pedir" });
    await c.enviar({ telefone: ANA, botaoId: "agora" });
    await c.enviar({ telefone: ANA, botaoId: "origem_unidade" });
    await c.enviar({ telefone: ANA, texto: "Aeroporto de Guarulhos, Terminal 2" });
    await c.enviar({ telefone: ANA, botaoId: "pax:1" });
    await c.enviar({ telefone: ANA, botaoId: "cc:cc1" });
    await c.enviar({ telefone: ANA, botaoId: "motivo:Visita a cliente" });
    await c.enviar({ telefone: ANA, botaoId: "confirmar" });
    expect(await c.enviar({ telefone: RTC, texto: "bom dia" })).toEqual([]);
    await c.enviar({ telefone: RTC, botaoId: "ACEITAR:TX-2026-00001" });
    expect(c.repo.corridas[0].status).toBe("aceita");
    const s = await c.enviar({ telefone: RTC, texto: "Carlos Souza, RTX4F21, 12 min" });
    expect(ultima(s, ANA).texto).toContain("foi aceita por");
  });
});
