import { supabase } from "@/lib/supabase";

/** Chama uma rota de API do próprio app enviando a sessão do usuário. */
export async function chamarApi<T = any>(caminho: string, corpo?: unknown, metodo: "POST" | "DELETE" = "POST"): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch(caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Erro ${resp.status}`);
  return json as T;
}
