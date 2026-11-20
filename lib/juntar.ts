import { normalizar } from "./precos";
import { paradasDa, type Parada } from "./multidestino";

/** Corrida o bastante para sugerir e juntar. */
export type CorridaJuntar = {
  id: string; protocolo: string; status: string; data_hora_prevista: string; origem: string; destino: string;
  origem_lat?: number | null; origem_lng?: number | null; qtd_passageiros: number; solicitante_id: string;
  paradas?: unknown; juntada_em?: string | null; aprovacao_status?: string | null;
  solicitante_nome?: string | null;
};
export type Sugestao = { principal: CorridaJuntar; outra: CorridaJuntar; minutos: number; passageiros: number };

export const ABERTAS_PARA_JUNTAR = ["solicitada", "enviada", "sem_resposta", "recusada"];
const MAX_PASSAGEIROS_CARRO = 4;

/** Distância aproximada em metros (equiretangular; basta para "mesmo lugar"). */
function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * r;
}

/** Mesma origem: o mesmo texto (sem acento e caixa) ou pontos a menos de 300 m. */
export function mesmaOrigem(a: CorridaJuntar, b: CorridaJuntar): boolean {
  if (normalizar(a.origem) === normalizar(b.origem)) return true;
  if (a.origem_lat != null && a.origem_lng != null && b.origem_lat != null && b.origem_lng != null) {
    return metros({ lat: Number(a.origem_lat), lng: Number(a.origem_lng) }, { lat: Number(b.origem_lat), lng: Number(b.origem_lng) }) <= 300;
  }
  return false;
}

/**
 * Pares de corridas ainda não aceitas, de pessoas diferentes, com a mesma origem e horários próximos
 * (até `janelaMin`), que cabem num carro comum. A principal é a de horário mais cedo. Cada corrida entra em um par só.
 */
export function sugestoesJuntar(corridas: CorridaJuntar[], janelaMin = 20): Sugestao[] {
  const abertas = corridas.filter((c) => ABERTAS_PARA_JUNTAR.includes(c.status) && !c.juntada_em && c.aprovacao_status !== "recusada")
    .sort((a, b) => new Date(a.data_hora_prevista).getTime() - new Date(b.data_hora_prevista).getTime());
  const usadas = new Set<string>();
  const saida: Sugestao[] = [];
  for (let i = 0; i < abertas.length; i++) {
    const a = abertas[i];
    if (usadas.has(a.id)) continue;
    for (let j = i + 1; j < abertas.length; j++) {
      const b = abertas[j];
      if (usadas.has(b.id) || b.solicitante_id === a.solicitante_id) continue;
      const minutos = Math.round((new Date(b.data_hora_prevista).getTime() - new Date(a.data_hora_prevista).getTime()) / 60_000);
      if (minutos > janelaMin) break;
      const passageiros = (a.qtd_passageiros || 1) + (b.qtd_passageiros || 1);
      if (passageiros > MAX_PASSAGEIROS_CARRO || !mesmaOrigem(a, b)) continue;
      saida.push({ principal: a, outra: b, minutos, passageiros });
      usadas.add(a.id); usadas.add(b.id);
      break;
    }
  }
  return saida;
}

/** Destinos da corrida juntada: os da principal (paradas + final) e os da outra, sem repetir. */
export function destinosJuntados(principal: CorridaJuntar & { destino_lat?: number | null; destino_lng?: number | null },
  outra: CorridaJuntar & { destino_lat?: number | null; destino_lng?: number | null }): Parada[] {
  const lista: Parada[] = [
    ...paradasDa(principal), { texto: principal.destino, lat: principal.destino_lat ?? null, lng: principal.destino_lng ?? null },
    ...paradasDa(outra), { texto: outra.destino, lat: outra.destino_lat ?? null, lng: outra.destino_lng ?? null },
  ];
  const vistos = new Set<string>();
  return lista.filter((p) => { const k = normalizar(p.texto); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
}
