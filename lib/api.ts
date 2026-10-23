import { supabase } from "@/lib/supabase";

/** Chama uma rota de API do próprio app enviando a sessão do usuário. */
export async function chamarApi<T = any>(caminho: string, corpo?: unknown, metodo: "POST" | "DELETE" = "POST"): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch(caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  let json: any = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* resposta não é JSON (erro do servidor ou da hospedagem) */ }
  if (!resp.ok) {
    throw new Error(json?.erro ?? `Erro ${resp.status} no servidor. Veja /api/saude para conferir a configuração e os logs da hospedagem para o detalhe.`);
  }
  return json as T;
}
