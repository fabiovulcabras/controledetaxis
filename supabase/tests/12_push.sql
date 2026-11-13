\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Inscrições de notificação';
insert into push_inscricoes (endpoint, p256dh, auth, tipo, solicitante_id) select 'https://push/1', 'p', 'a', 'solicitante', id from solicitantes limit 1;
select ok('inscrição de solicitante gravada', (select count(*) = 1 from push_inscricoes));
do $$ begin insert into push_inscricoes (endpoint, p256dh, auth, tipo) values ('https://push/2', 'p', 'a', 'fornecedor'); raise exception 'aceitou'; exception when check_violation then null; end $$;
select ok('fornecedor sem fornecedor_id é recusado', (select count(*) = 1 from push_inscricoes));
