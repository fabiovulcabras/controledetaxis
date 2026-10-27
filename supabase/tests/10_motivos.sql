\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== Motivos';
select ok('três motivos iniciais, na ordem', (select string_agg(nome, '|' order by ordem) = 'Visita a cliente|Viagem / aeroporto|Hora extra' from motivos));
insert into motivos (nome, ordem) values ('Visita a fornecedor', 4);
select ok('novo motivo cadastrado', (select count(*) = 4 from motivos where ativo));
do $$ begin insert into motivos (nome) values ('HORA EXTRA'); raise notice 'duplicou'; exception when unique_violation then null; end $$;
select ok('motivo repetido (maiúscula/acento) é recusado', (select count(*) = 1 from motivos where fn_sem_acento(nome) = 'hora extra'));
