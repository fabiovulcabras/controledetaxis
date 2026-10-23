\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;

select '== Código de acesso do fornecedor';
select ok('todo fornecedor tem código de 6 dígitos', (select bool_and(codigo_acesso ~ '^[0-9]{6}$') from fornecedores));
insert into fornecedores (nome, telefone_whatsapp, prioridade, prazo_resposta_min) values ('Teste Código', '5511900001111', 9, 10);
select ok('novo fornecedor já nasce com código', (select codigo_acesso ~ '^[0-9]{6}$' from fornecedores where nome = 'Teste Código'));
