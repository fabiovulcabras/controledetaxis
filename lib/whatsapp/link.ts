import type { Corrida } from "../bot/tipos";
import { brl, formatarDataHora, formatarHora } from "../datas";
import { normalizarTelefone } from "../telefone";

/**
 * Links de conversa do WhatsApp (wa.me). Abrem o WhatsApp de quem toca com a mensagem pronta;
 * a pessoa só confirma o envio. Gratuito e permitido pelo WhatsApp, sem API.
 */
export type LinkWhatsApp = { rotulo: string; url: string };

export const linkWhatsApp = (telefone: string, texto: string) =>
  `https://wa.me/${normalizarTelefone(telefone)}?text=${encodeURIComponent(texto)}`;

/** Endereço público do app: NEXT_PUBLIC_APP_URL ou o domínio da própria requisição. */
export function urlApp(req?: Request): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (env) return env;
  return req ? new URL(req.url).origin : "";
}

const quando = (c: Pick<Corrida, "tipo" | "data_hora_prevista">) =>
  c.tipo === "imediata" ? `agora (${formatarHora(c.data_hora_prevista)})` : formatarDataHora(c.data_hora_prevista);

export function msgNovaCorridaFornecedor(c: Corrida, solicitante: string, base: string): string {
  return [
    `*Nova solicitação de táxi ${c.protocolo}*`,
    `Solicitante: ${solicitante}`,
    `Quando: ${quando(c)}`,
    `Origem: ${c.origem}`,
    `Destino: ${c.destino}`,
    `Passageiros: ${c.qtd_passageiros}${c.outros_passageiros ? ` (${c.outros_passageiros})` : ""}`,
    "",
    "Para aceitar ou recusar, abra:",
    `${base}/f/${c.token_fornecedor}`,
  ].join("\n");
}

export function msgAceitaSolicitante(c: Corrida, fornecedor: string, base: string, tokenPedido?: string): string {
  const motorista = [c.motorista, c.veiculo_placa ? `placa ${c.veiculo_placa}` : null, c.eta_minutos ? `chega em cerca de ${c.eta_minutos} min` : null].filter(Boolean).join(", ");
  return [
    `Sua corrida ${c.protocolo} foi aceita por ${fornecedor}.`,
    motorista ? `Motorista: ${motorista}.` : null,
    tokenPedido ? `\nAcompanhe: ${base}/pedir/${tokenPedido}` : null,
  ].filter(Boolean).join("\n");
}

export const msgRecusaSolicitante = (c: Corrida, fornecedor: string) =>
  `O fornecedor ${fornecedor} não poderá atender a corrida ${c.protocolo}. O planejamento foi avisado e vai providenciar outro fornecedor.`;

export const msgRecusaPlanejamento = (c: Corrida, fornecedor: string, solicitante: string, base: string) =>
  `Corrida ${c.protocolo} recusada por ${fornecedor}. Solicitante: ${solicitante}. Reenvie a outro fornecedor: ${base}/corridas?id=${c.id}`;

export const msgCancelamentoFornecedor = (c: Corrida, motivo: string) =>
  `A corrida ${c.protocolo} (${formatarDataHora(c.data_hora_prevista)}, saindo de ${c.origem}) foi cancelada. Motivo: ${motivo}. Não é preciso fazer nada.`;

export const msgNaoRealizadaSolicitante = (c: Corrida) =>
  `O fornecedor informou que a corrida ${c.protocolo} não foi realizada. Se ainda precisar do táxi, faça um novo pedido.`;

export const msgConcluidaPlanejamento = (c: Corrida, valor: number, teto: number) =>
  `Corrida ${c.protocolo} concluída com valor ${brl(valor)}, acima do teto de ${brl(teto)}.`;

export const msgLinkPedido = (nome: string, base: string, token: string) =>
  `Olá, ${nome.split(" ")[0]}! Este é o seu link pessoal para pedir táxi:\n${base}/pedir/${token}\n\nSalve na tela inicial do celular. Não compartilhe: os pedidos feitos por ele saem no seu nome.`;
