\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
select '== E-mail de login do fornecedor';
update fornecedores set email = '  Contato@Taxi.COM ' where id = (select id from fornecedores order by nome limit 1);
select ok('e-mail gravado em minúsculas e sem espaços', (select count(*) = 1 from fornecedores where email = 'contato@taxi.com'));
do $$ begin update fornecedores set email = 'CONTATO@taxi.com' where id = (select id from fornecedores order by nome desc limit 1); raise exception 'aceitou'; exception when unique_violation then null; end $$;
select ok('dois fornecedores não usam o mesmo e-mail', (select count(*) = 1 from fornecedores where email = 'contato@taxi.com'));
do $$ begin update fornecedores set email = 'sem-arroba' where id = (select id from fornecedores order by nome desc limit 1); raise exception 'aceitou'; exception when check_violation then null; end $$;
select ok('e-mail inválido é recusado', (select count(*) = 0 from fornecedores where email = 'sem-arroba'));
update fornecedores set email = '   ' where id = (select id from fornecedores order by nome desc limit 1);
select ok('e-mail em branco vira vazio', (select email is null from fornecedores order by nome desc limit 1));
