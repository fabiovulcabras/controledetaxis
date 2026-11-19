-- 018: distância calculada pelo Google Routes (fonte 'google'). Rode depois da 017.
begin;
alter table corridas drop constraint if exists corridas_distancia_fonte_check;
alter table corridas add constraint corridas_distancia_fonte_check
  check (distancia_fonte is null or distancia_fonte in ('google','ors','osrm','estimada'));
commit;
