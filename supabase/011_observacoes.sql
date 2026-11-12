-- Observações da corrida (opcional): o solicitante preenche no pedido (link ou WhatsApp) e o fornecedor vê
-- na mensagem da corrida, na página de resposta e no portal. Rode depois da 010.
begin;

alter table corridas add column if not exists observacoes text
  check (observacoes is null or char_length(observacoes) <= 500);

-- A lista do painel e do portal passa a trazer as observações (e a busca encontra por elas).
drop view if exists corridas_lista;
create view corridas_lista with (security_invoker = true) as
select c.*,
  s.nome as solicitante_nome, s.setor as solicitante_setor, s.telefone_whatsapp as solicitante_telefone,
  f.nome as fornecedor_nome, f.telefone_whatsapp as fornecedor_telefone,
  cc.codigo as centro_codigo, cc.descricao as centro_descricao,
  fn_sem_acento(concat_ws(' ', c.protocolo, s.nome, s.setor, c.origem, c.destino, c.motivo, c.observacoes, f.nome)) as busca
from corridas c
join solicitantes s on s.id = c.solicitante_id
left join fornecedores f on f.id = c.fornecedor_id
left join centros_custo cc on cc.id = c.centro_custo_id;
grant select on corridas_lista to authenticated, service_role;

commit;
