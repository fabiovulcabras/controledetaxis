-- ============ 003 — Melhorias de segurança, desempenho e relatórios ============
-- Rode no SQL Editor depois da 002. Pode rodar mais de uma vez.

-- ---------- Novos campos ----------
-- Chave única de cada envio do formulário: um toque duplo não cria duas corridas
alter table corridas add column if not exists chave_envio text;
create unique index if not exists corridas_chave_envio on corridas (chave_envio) where chave_envio is not null;
-- Fornecedores que já receberam a corrida (reenvio automático pula estes)
alter table corridas add column if not exists fornecedores_tentados uuid[] not null default '{}';
update corridas set fornecedores_tentados = array[fornecedor_id] where fornecedor_id is not null and fornecedores_tentados = '{}';
-- Distância estimada do trajeto (quando origem e destino têm coordenadas)
alter table corridas add column if not exists distancia_km numeric(8,2);

-- Link fixo do portal do fornecedor e tarifa de referência
alter table fornecedores add column if not exists token_portal text default fn_novo_token();
update fornecedores set token_portal = fn_novo_token() where token_portal is null;
alter table fornecedores alter column token_portal set not null;
create unique index if not exists fornecedores_token_portal on fornecedores (token_portal);
alter table fornecedores add column if not exists bandeirada numeric(10,2) check (bandeirada is null or bandeirada >= 0);
alter table fornecedores add column if not exists valor_km numeric(10,2) check (valor_km is null or valor_km >= 0);

-- Limite mensal de gasto por pessoa autorizada (gera alerta, não bloqueia)
alter table solicitantes add column if not exists limite_mensal numeric(10,2) check (limite_mensal is null or limite_mensal > 0);

-- Fornecedor de cada evento: base da taxa de aceite e do tempo de resposta
alter table corrida_eventos add column if not exists fornecedor_id uuid references fornecedores;
update corrida_eventos e set fornecedor_id = c.fornecedor_id from corridas c where c.id = e.corrida_id and e.fornecedor_id is null;
create index if not exists corrida_eventos_fornecedor on corrida_eventos (fornecedor_id, criado_em);
create index if not exists corridas_atualizado on corridas (status, atualizado_em desc);

insert into parametros (chave, valor, descricao) values
  ('limite_pedidos_hora', '6', 'Máximo de pedidos por pessoa autorizada em uma hora (protege o link pessoal)'),
  ('reenvio_automatico', 'sim', '"sim" passa a corrida ao próximo fornecedor da prioridade quando há recusa (e, com a API oficial, quando não há resposta)'),
  ('planejamento_emails', '', 'E-mails que recebem os alertas (separados por vírgula). Exige RESEND_API_KEY no servidor'),
  ('tolerancia_trajeto_pct', '30', 'Alerta quando o valor passa da tarifa de referência do trajeto mais esta porcentagem')
on conflict (chave) do nothing;

-- ---------- Limite de uso das rotas públicas ----------
create table if not exists limite_uso (chave text, janela timestamptz, contagem int not null default 0, primary key (chave, janela));
alter table limite_uso enable row level security;

-- Conta um uso e diz se ainda está dentro do limite na janela atual
create or replace function fn_consumir_limite(p_chave text, p_limite int, p_janela_seg int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_janela timestamptz := to_timestamp(floor(extract(epoch from now()) / p_janela_seg) * p_janela_seg); v_n int;
begin
  insert into limite_uso as l (chave, janela, contagem) values (p_chave, v_janela, 1)
  on conflict (chave, janela) do update set contagem = l.contagem + 1
  returning contagem into v_n;
  if random() < 0.02 then delete from limite_uso where janela < now() - interval '1 day'; end if;
  return v_n <= p_limite;
end $$;
revoke execute on function fn_consumir_limite(text, int, int) from public, anon, authenticated;
grant execute on function fn_consumir_limite(text, int, int) to service_role;

-- ---------- fn_mudar_status: guarda os fornecedores tentados e o fornecedor de cada evento ----------
create or replace function fn_mudar_status(p_corrida uuid, p_status status_corrida, p_origem origem_evento,
  p_obs text default null, p_campos jsonb default '{}'::jsonb)
returns corridas language plpgsql security definer set search_path = public as $$
declare v_atual corridas; v_nova corridas; v_uid uuid := auth.uid();
begin
  if v_uid is not null and not is_planejamento() then raise exception 'Sem permissão para alterar corridas'; end if;
  v_atual := (select c from corridas c where c.id = p_corrida for update);
  if v_atual.id is null then raise exception 'Corrida não encontrada'; end if;
  if p_status is not null and not fn_transicao_valida(v_atual.status, p_status) then
    raise exception 'Mudança de status não permitida: % → %', v_atual.status, p_status;
  end if;
  if p_status = 'contestada' and v_atual.status = 'validada' and coalesce(btrim(p_obs), '') = '' then
    raise exception 'Informe a justificativa para reabrir uma corrida validada';
  end if;
  p_campos := coalesce(p_campos, '{}'::jsonb);

  update corridas set
    status = coalesce(p_status, status),
    fornecedor_id = case when p_campos ? 'fornecedor_id' then (p_campos->>'fornecedor_id')::uuid else fornecedor_id end,
    motorista = case when p_campos ? 'motorista' then p_campos->>'motorista' else motorista end,
    veiculo_placa = case when p_campos ? 'veiculo_placa' then p_campos->>'veiculo_placa' else veiculo_placa end,
    eta_minutos = case when p_campos ? 'eta_minutos' then (p_campos->>'eta_minutos')::int else eta_minutos end,
    valor_informado = case when p_campos ? 'valor_informado' then (p_campos->>'valor_informado')::numeric else valor_informado end,
    prazo_resposta_em = case when p_campos ? 'prazo_resposta_em' then (p_campos->>'prazo_resposta_em')::timestamptz else prazo_resposta_em end,
    motivo_recusa = case when p_campos ? 'motivo_recusa' then p_campos->>'motivo_recusa' else motivo_recusa end,
    motivo_cancelamento = case when p_campos ? 'motivo_cancelamento' then p_campos->>'motivo_cancelamento' else motivo_cancelamento end,
    fornecedores_tentados = case when p_campos ? 'fornecedores_tentados'
      then array(select jsonb_array_elements_text(p_campos->'fornecedores_tentados')::uuid) else fornecedores_tentados end,
    token_fornecedor = case when p_campos ? 'token_fornecedor' then p_campos->>'token_fornecedor' else token_fornecedor end,
    lembrete_enviado_em = case when p_campos ? 'lembrete_enviado_em' then (p_campos->>'lembrete_enviado_em')::timestamptz else lembrete_enviado_em end,
    validado_por = case when p_status = 'validada' then v_uid when p_status = 'contestada' then null else validado_por end,
    validado_em = case when p_status = 'validada' then now() when p_status = 'contestada' then null else validado_em end
  where id = p_corrida
  returning * into v_nova;

  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao, fornecedor_id)
  values (p_corrida, v_atual.status, v_nova.status, p_origem, v_uid, p_obs, v_nova.fornecedor_id);
  return v_nova;
end $$;


-- ---------- Lista de corridas com nomes e texto de busca (filtros e paginação no banco) ----------
create or replace function fn_sem_acento(t text) returns text language sql immutable as
$$ select translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') $$;

create or replace view corridas_lista with (security_invoker = true) as
select c.*,
  s.nome as solicitante_nome, s.setor as solicitante_setor, s.telefone_whatsapp as solicitante_telefone,
  f.nome as fornecedor_nome, f.telefone_whatsapp as fornecedor_telefone,
  cc.codigo as centro_codigo, cc.descricao as centro_descricao,
  fn_sem_acento(concat_ws(' ', c.protocolo, s.nome, s.setor, c.origem, c.destino, c.motivo, f.nome)) as busca
from corridas c
join solicitantes s on s.id = c.solicitante_id
left join fornecedores f on f.id = c.fornecedor_id
left join centros_custo cc on cc.id = c.centro_custo_id;
grant select on corridas_lista to authenticated, service_role;

-- Contagem por status e valor informado com os mesmos filtros da lista
create or replace function fn_contar_corridas(p_de timestamptz, p_ate timestamptz, p_fornecedor uuid default null, p_busca text default null)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'por_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from corridas_lista
        where data_hora_prevista between p_de and p_ate
          and (p_fornecedor is null or fornecedor_id = p_fornecedor)
          and (coalesce(p_busca, '') = '' or busca like '%' || fn_sem_acento(p_busca) || '%')
        group by status) x), '{}'::jsonb))
$$;

-- ---------- Resumo para a visão geral e os relatórios ----------
create or replace function fn_resumo_periodo(p_de timestamptz, p_ate timestamptz) returns jsonb
language sql stable set search_path = public as $$
  with base as (
    select * from corridas where data_hora_prevista between p_de and p_ate
  ), valorizadas as (
    select * from base where status in ('concluida','validada','contestada') and valor_informado is not null
  ), ev as (
    select e.*, lag(e.criado_em) over (partition by e.corrida_id order by e.criado_em) as anterior_em,
           lag(e.status_novo) over (partition by e.corrida_id order by e.criado_em) as anterior_status
    from corrida_eventos e
    where e.criado_em between p_de - interval '1 day' and p_ate + interval '1 day'
  )
  select jsonb_build_object(
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from base group by status) x), '{}'::jsonb),
    'total', (select count(*) from base),
    'valor_total', (select coalesce(sum(valor_informado), 0) from valorizadas),
    'valor_contestado', (select coalesce(sum(i.valor), 0) from fatura_itens i where i.decisao = 'contestado' and i.decidido_em between p_de and p_ate),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'qtd', qtd, 'valor', valor) order by dia) from (
        select to_char(data_hora_prevista at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, count(*) as qtd,
          coalesce(sum(valor_informado) filter (where status in ('concluida','validada','contestada')), 0) as valor
        from base group by 1) x), '[]'::jsonb),
    'por_centro', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
        select jsonb_build_object('nome', coalesce(cc.codigo || ' · ' || cc.descricao, 'Sem centro de custo'), 'qtd', count(b.*),
          'valor', coalesce(sum(b.valor_informado) filter (where b.status in ('concluida','validada','contestada')), 0)) x
        from base b left join centros_custo cc on cc.id = b.centro_custo_id group by cc.codigo, cc.descricao) y), '[]'::jsonb),
    'por_solicitante', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
        select jsonb_build_object('nome', s.nome, 'setor', s.setor, 'qtd', count(b.*), 'canceladas', count(*) filter (where b.status = 'cancelada'),
          'valor', coalesce(sum(b.valor_informado) filter (where b.status in ('concluida','validada','contestada')), 0), 'limite', s.limite_mensal) x
        from base b join solicitantes s on s.id = b.solicitante_id group by s.id) y), '[]'::jsonb),
    'por_fornecedor', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
        select jsonb_build_object('nome', f.nome,
          'enviadas', (select count(*) from ev where ev.fornecedor_id = f.id and ev.status_novo = 'enviada' and ev.criado_em between p_de and p_ate),
          'aceitas', (select count(*) from ev where ev.fornecedor_id = f.id and ev.status_novo = 'aceita' and ev.criado_em between p_de and p_ate),
          'recusadas', (select count(*) from ev where ev.fornecedor_id = f.id and ev.status_novo = 'recusada' and ev.criado_em between p_de and p_ate),
          'sem_resposta', (select count(*) from ev where ev.fornecedor_id = f.id and ev.status_novo = 'sem_resposta' and ev.criado_em between p_de and p_ate),
          'minutos_resposta', (select round(avg(extract(epoch from ev.criado_em - ev.anterior_em) / 60)::numeric, 1) from ev
             where ev.fornecedor_id = f.id and ev.status_novo in ('aceita','recusada') and ev.anterior_status = 'enviada' and ev.criado_em between p_de and p_ate),
          'qtd', (select count(*) from valorizadas v where v.fornecedor_id = f.id),
          'valor', (select coalesce(sum(valor_informado), 0) from valorizadas v where v.fornecedor_id = f.id)) x
        from fornecedores f) y where (x->>'enviadas')::int > 0 or (x->>'qtd')::int > 0), '[]'::jsonb)
  )
$$;

-- ---------- Conciliação: aceitar todos os itens conciliados de uma vez ----------
create or replace function fn_aceitar_conciliados(p_fatura uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  if not is_planejamento() then raise exception 'Sem permissão para decidir itens da fatura'; end if;
  for r in select id from fatura_itens where fatura_id = p_fatura and situacao = 'conciliado' and decisao is null loop
    perform fn_decidir_item(r.id, 'aceito', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function fn_aceitar_conciliados(uuid) from public, anon;
grant execute on function fn_aceitar_conciliados(uuid) to authenticated, service_role;

-- ---------- Atualização em tempo real no painel ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['corridas', 'corrida_eventos', 'mensagens'] loop
      begin
        execute format('alter publication supabase_realtime add table %I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
