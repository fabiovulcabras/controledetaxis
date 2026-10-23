import type { SupabaseClient } from "@supabase/supabase-js";

export type LocalPedido = { nome: string; endereco: string; texto: string; lat: number | null; lng: number | null; tipo: "unidade" | "local"; minha: boolean };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Coordenadas de um endereço pelo Photon (OpenStreetMap, gratuito). Devolve null se não achar ou demorar. */
async function geocodificar(endereco: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(endereco.slice(0, 160))}&limit=1&bbox=-74.0,-33.8,-34.7,5.3`, {
      headers: { "User-Agent": "ControleDeTaxis/1.0" }, cache: "no-store", signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const [lng, lat] = (await r.json())?.features?.[0]?.geometry?.coordinates ?? [];
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; }
}

/**
 * Unidades com endereço e locais cadastrados, para a pessoa escolher como origem ou destino.
 * A unidade da pessoa vem primeiro. Quem ainda não tem coordenadas é geocodificado aqui (até 4 por vez) e gravado,
 * para a distância e a tarifa de referência funcionarem também quando a pessoa escolhe um local da lista.
 */
export async function locaisDoPedido(db: SupabaseClient, unidadeDaPessoa: string | null | undefined): Promise<LocalPedido[]> {
  const [u, l] = await Promise.all([
    db.from("unidades").select("*").eq("ativo", true).order("nome"),
    db.from("locais").select("*").eq("ativo", true).order("nome"),
  ]);
  const unidades = (u.data ?? []).filter((x: any) => String(x.endereco_padrao ?? "").trim());
  const locais = l.error ? [] : l.data ?? []; // sem a migração 005, só as unidades
  const lista: (LocalPedido & { tabela: string; id: string })[] = [
    ...unidades.map((x: any) => ({ tabela: "unidades", id: x.id, nome: x.nome, endereco: x.endereco_padrao.trim(), lat: num(x.lat), lng: num(x.lng), tipo: "unidade" as const, minha: x.id === unidadeDaPessoa })),
    ...locais.map((x: any) => ({ tabela: "locais", id: x.id, nome: x.nome, endereco: x.endereco.trim(), lat: num(x.lat), lng: num(x.lng), tipo: "local" as const, minha: false })),
  ].map((x) => ({ ...x, texto: `${x.nome} – ${x.endereco}` }));
  lista.sort((a, b) => Number(b.minha) - Number(a.minha));

  const semCoordenadas = lista.filter((x) => x.lat == null).slice(0, 4);
  await Promise.all(semCoordenadas.map(async (x) => {
    const p = await geocodificar(x.endereco);
    if (!p) return;
    x.lat = p.lat; x.lng = p.lng;
    await db.from(x.tabela).update({ lat: p.lat, lng: p.lng }).eq("id", x.id); // sem a coluna (migração 005), só ignora
  }));
  return lista.map(({ tabela, id, ...resto }) => resto);
}
