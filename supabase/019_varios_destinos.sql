-- 019: corrida com vários destinos. "destino" passa a ser o destino final (o mais longe da origem) e
-- "paradas" guarda as paradas anteriores, na ordem de menor km: [{"texto": "...", "lat": -22.8, "lng": -46.3}].
-- O km rodado (origem → paradas → destino final) fica em distancia_km. Rode depois da 018.
begin;

alter table corridas add column if not exists paradas jsonb not null default '[]'::jsonb;
alter table corridas drop constraint if exists corridas_paradas_lista;
alter table corridas add constraint corridas_paradas_lista check (jsonb_typeof(paradas) = 'array' and jsonb_array_length(paradas) <= 4);

-- A lista do painel traz as paradas, e a busca acha a corrida pelo endereço de uma parada
drop view if exists corridas_lista;
create view corridas_lista with (security_invoker = true) as
select c.*,
  s.nome as solicitante_nome, s.setor as solicitante_setor, s.telefone_whatsapp as solicitante_telefone,
  f.nome as fornecedor_nome, f.telefone_whatsapp as fornecedor_telefone,
  f.valor_km as fornecedor_valor_km, f.bandeirada as fornecedor_bandeirada,
  cc.codigo as centro_codigo, cc.descricao as centro_descricao,
  fn_sem_acento(concat_ws(' ', c.protocolo, s.nome, s.setor, c.origem, c.destino,
    (select string_agg(p->>'texto', ' ') from jsonb_array_elements(c.paradas) p),
    c.motivo, c.observacoes, f.nome)) as busca
from corridas c
join solicitantes s on s.id = c.solicitante_id
left join fornecedores f on f.id = c.fornecedor_id
left join centros_custo cc on cc.id = c.centro_custo_id;
grant select on corridas_lista to authenticated, service_role;

commit;
