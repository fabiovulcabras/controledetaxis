-- 017: a lista de corridas traz a tarifa por km do fornecedor (para mostrar km, valor por km e valor da tabela
-- lado a lado) e as colunas novas de distância da 016. Rode depois da 016.
begin;

drop view if exists corridas_lista;
create view corridas_lista with (security_invoker = true) as
select c.*,
  s.nome as solicitante_nome, s.setor as solicitante_setor, s.telefone_whatsapp as solicitante_telefone,
  f.nome as fornecedor_nome, f.telefone_whatsapp as fornecedor_telefone,
  f.valor_km as fornecedor_valor_km, f.bandeirada as fornecedor_bandeirada,
  cc.codigo as centro_codigo, cc.descricao as centro_descricao,
  fn_sem_acento(concat_ws(' ', c.protocolo, s.nome, s.setor, c.origem, c.destino, c.motivo, c.observacoes, f.nome)) as busca
from corridas c
join solicitantes s on s.id = c.solicitante_id
left join fornecedores f on f.id = c.fornecedor_id
left join centros_custo cc on cc.id = c.centro_custo_id;
grant select on corridas_lista to authenticated, service_role;

commit;
