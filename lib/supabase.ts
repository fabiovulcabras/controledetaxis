import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** false quando o ambiente (ex.: deploy de Preview na Vercel) não tem as variáveis do Supabase. */
export const supabaseConfigurado = Boolean(url && chave);

// Sem as variáveis, usa valores provisórios para o build não falhar ao gerar as páginas;
// a tela de login mostra o aviso de configuração em vez de tentar conectar.
export const supabase = createClient(url || "https://configure-o-supabase.invalid", chave || "chave-ausente");
