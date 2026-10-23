import { describe, expect, it } from "vitest";
import { processarEntrada, lerMotorista } from "../lib/bot/motor";
import { despachar, enviarLembretes, verificarPrazos } from "../lib/bot/acoes";
import { linkWhatsApp, msgNovaCorridaFornecedor, msgAceitaSolicitante } from "../lib/whatsapp/link";
import { lerDataHora, lerValor, formatarDataHora, dataSP } from "../lib/datas";
import { normalizarTelefone, variantesTelefone } from "../lib/telefone";
import { repoExemplo } from "./repo-memoria";
import { lerFaturaCsv } from "../lib/csv";
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
