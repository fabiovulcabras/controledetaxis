/**
 * fetch para os clientes Supabase do servidor. O Next.js 14 guarda em cache as respostas de fetch feitas nas rotas de API
 * (mesma URL = mesma resposta), o que fazia o portal e as telas mostrarem dados já apagados ou alterados no banco.
 * Dados do banco nunca podem vir de cache: toda consulta vai direto ao Supabase.
 */
export const fetchSemCache: typeof fetch = (entrada, init) => fetch(entrada, { ...init, cache: "no-store" });
