import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { TIPOS_ARQUIVO } from "./extras";

/** Bucket privado do Supabase Storage criado pela migração 015. Só o servidor grava e gera links. */
const BUCKET = "documentos";

/** Grava o arquivo em <pasta>/<uuid>.<ext> e devolve o caminho. */
export async function guardarArquivo(pasta: string, arquivo: File): Promise<string> {
  const ext = TIPOS_ARQUIVO[arquivo.type] ?? "bin";
  const caminho = `${pasta}/${randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(caminho, Buffer.from(await arquivo.arrayBuffer()), { contentType: arquivo.type, upsert: false });
  if (error) {
    if (/bucket/i.test(error.message)) throw new Error("O armazenamento de arquivos não está pronto. Rode supabase/015_espelho.sql no Supabase.");
    throw new Error(`Não foi possível guardar o arquivo: ${error.message}`);
  }
  return caminho;
}

/** Link temporário (10 min) para abrir um arquivo guardado. */
export async function linkArquivo(caminho: string, segundos = 600): Promise<string> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error || !data?.signedUrl) throw new Error("Arquivo não encontrado.");
  return data.signedUrl;
}

/** Remove um arquivo (ex.: o registro no banco falhou depois do envio). */
export async function apagarArquivo(caminho: string): Promise<void> {
  await supabaseAdmin().storage.from(BUCKET).remove([caminho]).catch(() => null);
}
