-- 016: distância por rota em todas as corridas (OpenRouteService) e comparativo KM × tabela.
-- Guarda de onde veio a distância: 'ors' (OpenRouteService), 'osrm' (servidor público) ou 'estimada' (linha reta × 1,3).
-- Rode uma vez no SQL Editor do Supabase.
begin;
alter table corridas add column if not exists distancia_fonte text;
alter table corridas drop constraint if exists corridas_distancia_fonte_check;
alter table corridas add constraint corridas_distancia_fonte_check check (distancia_fonte is null or distancia_fonte in ('ors','osrm','estimada'));
alter table corridas add column if not exists distancia_calculada_em timestamptz;
update corridas set distancia_fonte = 'osrm' where distancia_km is not null and distancia_fonte is null;
comment on column corridas.distancia_km is 'Distância do trajeto origem → destino por ruas (km), calculada pelo app';
commit;
