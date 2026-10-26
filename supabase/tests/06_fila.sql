\set QUIET on
\pset tuples_only on
\pset format unaligned
create function ok(rotulo text, cond boolean) returns text language sql as $$ select case when cond then '  OK   ' else '  FALHA' end || ' ' || rotulo $$;
create function t(p_ordem int) returns text language sql as $$ select status from corrida_tentativas where corrida_id = 'c6000000-0000-0000-0000-000000000006' and ordem = p_ordem $$;

select '== Fila de fornecedores (corrida_tentativas)';
insert into corridas (id, solicitante_id, data_hora_prevista, origem, destino, motivo)
select 'c6000000-0000-0000-0000-000000000006', id, now(), 'A', 'B', 'teste' from solicitantes limit 1;
select ok('corrida só solicitada ainda não tem tentativa', (select count(*) = 0 from corrida_tentativas where corrida_id = 'c6000000-0000-0000-0000-000000000006'));

update corridas set status = 'enviada', fornecedor_id = (select id from fornecedores order by prioridade limit 1), prazo_resposta_em = now() + interval '5 min'
where id = 'c6000000-0000-0000-0000-000000000006';
select ok('enviada ao 1º fornecedor abre a tentativa 1 pendente com o prazo', t(1) = 'pendente'
  and (select prazo_em is not null and qstash_message_id is null from corrida_tentativas where corrida_id = 'c6000000-0000-0000-0000-000000000006' and ordem = 1));

update corrida_tentativas set qstash_message_id = 'msg_1' where corrida_id = 'c6000000-0000-0000-0000-000000000006';
update corridas set status = 'sem_resposta' where id = 'c6000000-0000-0000-0000-000000000006';
select ok('prazo vencido marca a tentativa 1 como expirada', t(1) = 'expirada');

update corridas set status = 'enviada', fornecedor_id = (select id from fornecedores order by prioridade offset 1 limit 1), prazo_resposta_em = now() + interval '5 min'
where id = 'c6000000-0000-0000-0000-000000000006';
select ok('próximo da fila abre a tentativa 2 pendente, sem agendamento ainda', t(2) = 'pendente'
  and (select qstash_message_id is null from corrida_tentativas where corrida_id = 'c6000000-0000-0000-0000-000000000006' and ordem = 2));

update corrida_tentativas set qstash_message_id = 'msg_2' where corrida_id = 'c6000000-0000-0000-0000-000000000006' and ordem = 2;
update corridas set prazo_resposta_em = now() + interval '20 min' where id = 'c6000000-0000-0000-0000-000000000006';
select ok('prazo estendido limpa o agendamento para reagendar', (select qstash_message_id is null from corrida_tentativas where corrida_id = 'c6000000-0000-0000-0000-000000000006' and ordem = 2));

update corridas set status = 'aceita' where id = 'c6000000-0000-0000-0000-000000000006';
select ok('aceite fecha a tentativa 2 como aceita', t(2) = 'aceita' and t(1) = 'expirada');
select ok('nunca há mais de uma tentativa pendente', (select count(*) = 0 from corrida_tentativas where status = 'pendente' and corrida_id = 'c6000000-0000-0000-0000-000000000006'));

insert into mensagens (direcao, canal, telefone, conteudo) values ('saida', 'evolution', '5511900000077', '{}');
select ok('canal evolution aceito nas mensagens', (select count(*) = 1 from mensagens where canal = 'evolution' and telefone = '5511900000077'));
