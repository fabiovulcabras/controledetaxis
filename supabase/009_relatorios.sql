-- 009: relatório com filtros (fornecedor, centro de custo, pessoa) e desempenho por viagem.
-- Rode uma vez no SQL Editor do Supabase.
--
-- Aceite por viagem: cada corrida enviada a um fornecedor conta uma vez para ele, com um resultado:
-- aceita, recusada ou sem resposta. Taxa de aceite = aceitas / (aceitas + recusadas + sem resposta).
-- Viagens canceladas antes da resposta ou ainda aguardando ficam fora da taxa.
-- Tempo de resposta: do envio ao aceite ou recusa daquele fornecedor, em minutos (média).

create or replace function fn_relatorio(
  p_de timestamptz, p_ate timestamptz,
  p_fornecedor uuid default null, p_centro uuid default null, p_solicitante uuid default null
) returns jsonb language sql stable set search_path = public as $$
  with base as (
    select c.* from corridas c
    where c.data_hora_prevista between p_de and p_ate
      and (p_centro is null or c.centro_custo_id = p_centro)
      and (p_solicitante is null or c.solicitante_id = p_solicitante)
  ), gasto as (                       -- corridas que contam para valores (do fornecedor filtrado, se houver)
    select * from base where p_fornecedor is null or fornecedor_id = p_fornecedor
  ), valorizadas as (
    select * from gasto where status in ('concluida', 'validada', 'contestada') and valor_informado is not null
  ), envios as (                      -- cada corrida enviada a cada fornecedor, uma vez
    select e.corrida_id, e.fornecedor_id, min(e.criado_em) as enviada_em
    from corrida_eventos e join base b on b.id = e.corrida_id
    where e.status_novo = 'enviada' and e.fornecedor_id is not null and (p_fornecedor is null or e.fornecedor_id = p_fornecedor)
    group by e.corrida_id, e.fornecedor_id
  ), viagens as (
    select v.*,
      exists (select 1 from corrida_eventos x where x.corrida_id = v.corrida_id and x.fornecedor_id = v.fornecedor_id and x.status_novo = 'aceita') as aceitou,
      exists (select 1 from corrida_eventos x where x.corrida_id = v.corrida_id and x.fornecedor_id = v.fornecedor_id and x.status_novo = 'recusada') as recusou,
      exists (select 1 from corrida_eventos x where x.corrida_id = v.corrida_id and x.fornecedor_id = v.fornecedor_id and x.status_novo = 'sem_resposta') as expirou,
      (select min(x.criado_em) from corrida_eventos x where x.corrida_id = v.corrida_id and x.fornecedor_id = v.fornecedor_id
         and x.status_novo in ('aceita', 'recusada') and x.criado_em >= v.enviada_em) as respondida_em
    from envios v
  ), resultado as (
    select *, case when aceitou then 'aceita' when recusou then 'recusada' when expirou then 'sem_resposta' else 'outra' end as fim from viagens
  ), por_forn as (
    select f.id, f.nome,
      count(r.*) as recebidas,
      count(r.*) filter (where r.fim = 'aceita') as aceitas,
      count(r.*) filter (where r.fim = 'recusada') as recusadas,
      count(r.*) filter (where r.fim = 'sem_resposta') as sem_resposta,
      avg(extract(epoch from r.respondida_em - r.enviada_em) / 60) filter (where r.respondida_em is not null) as minutos_resposta
    from fornecedores f left join resultado r on r.fornecedor_id = f.id
    where p_fornecedor is null or f.id = p_fornecedor
    group by f.id, f.nome
  ), valores_forn as (
    select fornecedor_id, count(*) as qtd, sum(valor_informado) as valor,
      sum(valor_tabela) as valor_tabela, count(valor_tabela) as com_tabela,
      count(*) filter (where valor_tabela is not null and valor_informado > valor_tabela + 0.005) as acima_tabela,
      coalesce(sum(valor_informado - valor_tabela) filter (where valor_tabela is not null and valor_informado > valor_tabela + 0.005), 0) as excesso
    from valorizadas group by fornecedor_id
  )
  select jsonb_build_object(
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from gasto group by status) x), '{}'::jsonb),
    'total', (select count(*) from gasto),
    'valor_total', (select coalesce(sum(valor_informado), 0) from valorizadas),
    'valor_tabela', (select coalesce(sum(valor_tabela), 0) from valorizadas where valor_tabela is not null),
    'valor_informado_com_tabela', (select coalesce(sum(valor_informado), 0) from valorizadas where valor_tabela is not null),
    'acima_tabela', (select count(*) from valorizadas where valor_tabela is not null and valor_informado > valor_tabela + 0.005),
    'excesso_tabela', (select coalesce(sum(valor_informado - valor_tabela), 0) from valorizadas where valor_tabela is not null and valor_informado > valor_tabela + 0.005),
    'valor_contestado', (select coalesce(sum(i.valor), 0) from fatura_itens i join gasto g on g.id = i.corrida_id where i.decisao = 'contestado'),
    'viagens', jsonb_build_object(
      'recebidas', (select count(*) from resultado),
      'aceitas', (select count(*) from resultado where fim = 'aceita'),
      'decididas', (select count(*) from resultado where fim <> 'outra'),
      'minutos_resposta', (select avg(extract(epoch from respondida_em - enviada_em) / 60) from resultado where respondida_em is not null)),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'qtd', qtd, 'valor', valor) order by dia) from (
        select to_char(data_hora_prevista at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, count(*) as qtd,
          coalesce(sum(valor_informado) filter (where status in ('concluida', 'validada', 'contestada')), 0) as valor
        from gasto group by 1) x), '[]'::jsonb),
    'por_fornecedor', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.nome, 'recebidas', p.recebidas, 'aceitas', p.aceitas, 'recusadas', p.recusadas, 'sem_resposta', p.sem_resposta,
        'minutos_resposta', p.minutos_resposta, 'qtd', coalesce(v.qtd, 0), 'valor', coalesce(v.valor, 0),
        'valor_tabela', coalesce(v.valor_tabela, 0), 'com_tabela', coalesce(v.com_tabela, 0), 'acima_tabela', coalesce(v.acima_tabela, 0), 'excesso', coalesce(v.excesso, 0))
        order by coalesce(v.valor, 0) desc, p.recebidas desc)
      from por_forn p left join valores_forn v on v.fornecedor_id = p.id
      where p.recebidas > 0 or coalesce(v.qtd, 0) > 0), '[]'::jsonb),
    'por_centro', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
        select jsonb_build_object('nome', coalesce(cc.codigo || ' · ' || cc.descricao, 'Sem centro de custo'), 'qtd', count(g.*),
          'valor', coalesce(sum(g.valor_informado) filter (where g.status in ('concluida', 'validada', 'contestada')), 0)) x
        from gasto g left join centros_custo cc on cc.id = g.centro_custo_id group by cc.codigo, cc.descricao) y), '[]'::jsonb),
    'por_solicitante', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
        select jsonb_build_object('nome', s.nome, 'setor', s.setor, 'qtd', count(g.*), 'canceladas', count(*) filter (where g.status = 'cancelada'),
          'valor', coalesce(sum(g.valor_informado) filter (where g.status in ('concluida', 'validada', 'contestada')), 0), 'limite', s.limite_mensal) x
        from gasto g join solicitantes s on s.id = g.solicitante_id group by s.id) y), '[]'::jsonb)
  )
$$;
grant execute on function fn_relatorio(timestamptz, timestamptz, uuid, uuid, uuid) to authenticated, service_role;
