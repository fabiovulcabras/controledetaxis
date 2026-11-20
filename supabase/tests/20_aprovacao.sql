\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
grant execute on function ok to authenticated;
\set pla '00000000-0000-0000-0000-00000000000b'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@x.com'), (:'pla', 'p@x.com');
update profiles set perfil = 'planejamento' where id = :'pla';

select '== Aprovação, alteração e juntar';
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo)
select (select id from solicitantes limit 1), now() + interval '2 hours', 'CD', 'Centro', 'x';
select fn_mudar_status((select id from corridas where origem = 'CD'), null, 'bot', 'Espera aprovação', '{"aprovacao_status": "pendente", "aprovacao_motivo": "valor acima de R$ 200"}') \g /dev/null
select ok('aprovação pendente gravada', (select aprovacao_status = 'pendente' and aprovacao_motivo like 'valor%' from corridas where origem = 'CD'));
select fn_mudar_status((select id from corridas where origem = 'CD'), null, 'bot', 'Alterada', jsonb_build_object(
  'data_hora_prevista', '2026-12-01 08:00-03', 'destino', 'Pereiras', 'destino_lat', null, 'distancia_km', null, 'preco_calculado_em', null,
  'qtd_passageiros', 3, 'outros_passageiros', 'Ana, Bia', 'paradas', '[{"texto": "Vila Rica", "lat": null, "lng": null}]'::jsonb)) \g /dev/null
select ok('alteração de horário, destino, passageiros e paradas', (select data_hora_prevista = '2026-12-01 08:00-03' and destino = 'Pereiras' and qtd_passageiros = 3
  and paradas->0->>'texto' = 'Vila Rica' and distancia_km is null from corridas where origem = 'CD'));
insert into corridas (solicitante_id, data_hora_prevista, origem, destino, motivo) select (select id from solicitantes limit 1), now(), 'CD2', 'X', 'x';
select fn_mudar_status((select id from corridas where origem = 'CD2'), 'cancelada', 'planejamento', 'Juntada', jsonb_build_object('juntada_em', (select id from corridas where origem = 'CD'))) \g /dev/null
select ok('corrida juntada aponta para a principal', (select juntada_em = (select id from corridas where origem = 'CD') and status = 'cancelada' from corridas where origem = 'CD2'));

select '== Recorrentes';
insert into corridas_recorrentes (solicitante_id, dias_semana, hora, origem, destino, motivo) select (select id from solicitantes limit 1), '{1,2,3,4,5}', '07:30', 'CD', 'Toledo', 'Turno';
select ok('recorrente gravada', (select count(*) = 1 from corridas_recorrentes));
do $$ begin insert into corridas_recorrentes (solicitante_id, dias_semana, hora, origem, destino, motivo) select (select id from solicitantes limit 1), '{8}', '07:30', 'a', 'b', 'c'; raise exception 'aceitou';
exception when others then if sqlerrm = 'aceitou' then raise; end if; end $$;
select ok('dia da semana inválido é recusado', true);

select '== MFA obrigatório';
select set_config('t.uid', :'pla', false) \g /dev/null
set role authenticated;
select ok('sem MFA obrigatório, planejamento acessa', is_planejamento());
reset role;
update parametros set valor = 'sim' where chave = 'mfa_obrigatorio';
set role authenticated;
select ok('com MFA obrigatório e sessão aal1, perde o acesso', not is_planejamento());
select set_config('t.jwt', '{"aal": "aal2"}', false) \g /dev/null
select ok('com a sessão confirmada (aal2), acessa', is_planejamento());
select ok('perfil continua usuário (leitura)', is_usuario());
reset role;
