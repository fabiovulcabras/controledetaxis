\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;

select '== Links de pedido e do fornecedor';
select ok('toda pessoa autorizada tem token de 64 caracteres', (select bool_and(length(token_pedido) = 64) from solicitantes));
select ok('tokens de pedido diferentes', (select count(distinct token_pedido) = count(*) from solicitantes));
insert into solicitantes (nome, telefone_whatsapp) values ('Nova Pessoa', '5511977776666');
select ok('nova pessoa já nasce com token', (select token_pedido is not null from solicitantes where nome = 'Nova Pessoa'));

insert into corridas (id, solicitante_id, fornecedor_id, data_hora_prevista, origem, destino, motivo)
select 'c9000000-0000-0000-0000-000000000009', id, 'f1000000-0000-0000-0000-000000000001', now(), 'A', 'B', 'teste' from solicitantes where nome = 'Nova Pessoa';
select set_config('t.tok', (select token_fornecedor from corridas where id = 'c9000000-0000-0000-0000-000000000009'), false) \g /dev/null
select ok('corrida nasce com token do fornecedor', length(current_setting('t.tok')) = 64);
select fn_mudar_status('c9000000-0000-0000-0000-000000000009', 'enviada', 'sistema', null,
  jsonb_build_object('fornecedor_id', 'f1000000-0000-0000-0000-000000000002', 'token_fornecedor', fn_novo_token())) \g /dev/null
select ok('token do fornecedor troca ao reenviar a outro', (select token_fornecedor <> current_setting('t.tok') and fornecedor_id = 'f1000000-0000-0000-0000-000000000002' from corridas where id = 'c9000000-0000-0000-0000-000000000009'));
