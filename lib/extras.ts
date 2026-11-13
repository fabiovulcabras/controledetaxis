// Extras da corrida (pedágio, espera, km a mais, parada extra), lançados pelo fornecedor com comprovante.
export const TIPOS_EXTRA = {
  pedagio: "Pedágio", espera: "Tempo de espera", km_extra: "Km a mais", parada_extra: "Parada extra", outro: "Outro",
} as const;
export type TipoExtra = keyof typeof TIPOS_EXTRA;
export const tipoExtraValido = (t: unknown): t is TipoExtra => typeof t === "string" && t in TIPOS_EXTRA;

export type Extra = {
  id: string; corrida_id: string; tipo: TipoExtra; descricao: string | null; valor: number; comprovante: string | null;
  status: "pendente" | "aprovado" | "recusado"; motivo_recusa: string | null; espelho_id: string | null; criado_em: string; decidido_em?: string | null;
};
export const STATUS_EXTRA: Record<Extra["status"], string> = { pendente: "Aguardando o planejamento", aprovado: "Aprovado", recusado: "Recusado" };

/** Corridas que aceitam extras (já concluídas). */
export const CORRIDA_ACEITA_EXTRA = ["concluida", "validada", "contestada"];

/** Arquivos aceitos como comprovante e NF: imagem ou PDF, até 4 MB (limite de envio da Vercel). */
export const TAMANHO_MAX_ARQUIVO = 4 * 1024 * 1024;
export const TIPOS_ARQUIVO: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
};
export function erroArquivo(f: { size: number; type: string } | null | undefined, somentePdf = false): string | null {
  if (!f || !f.size) return somentePdf ? "Anexe o PDF da NF." : "Anexe o comprovante (foto ou PDF).";
  if (somentePdf ? f.type !== "application/pdf" : !TIPOS_ARQUIVO[f.type]) return somentePdf ? "A NF precisa ser um arquivo PDF." : "Envie uma foto (JPG, PNG, WEBP, HEIC) ou um PDF.";
  if (f.size > TAMANHO_MAX_ARQUIVO) return "O arquivo passa de 4 MB. Tire a foto com resolução menor ou comprima o PDF.";
  return null;
}
