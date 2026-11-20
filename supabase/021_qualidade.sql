-- 021: motorista chegou, avaliação da corrida, feriados nos dias úteis, relatório de qualidade e por setor.
-- Rode uma vez no SQL Editor do Supabase (depois da 020).

-- ---------- Chegada do motorista e avaliação ----------
alter table corridas add column if not exists chegou_em timestamptz;
alter table corridas add column if not exists chegada_prevista_em timestamptz;
alter table corridas add column if not exists avaliacao smallint check (avaliacao between 1 and 5);
alter table corridas add column if not exists avaliacao_comentario text check (char_length(avaliacao_comentario) <= 500);
alter table corridas add column if not exists avaliada_em timestamptz;

insert into parametros (chave, valor, descricao) values
  ('avaliacao_ativa', 'sim', 'Pedir ao passageiro uma nota de 1 a 5 depois da corrida concluída (sim/nao)'),
  ('pontualidade_tolerancia_min', '5', 'Minutos de tolerância para considerar a chegada do motorista no horário')
on conflict (chave) do nothing;

-- Mesma função de antes, agora gravando também chegou_em e chegada_prevista_em
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
    chegou_em = case when p_campos ? 'chegou_em' then (p_campos->>'chegou_em')::timestamptz else chegou_em end,
    chegada_prevista_em = case when p_campos ? 'chegada_prevista_em' then (p_campos->>'chegada_prevista_em')::timestamptz else chegada_prevista_em end,
    validado_por = case when p_status = 'validada' then v_uid when p_status = 'contestada' then null else validado_por end,
    validado_em = case when p_status = 'validada' then now() when p_status = 'contestada' then null else validado_em end
  where id = p_corrida
  returning * into v_nova;

  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao, fornecedor_id)
  values (p_corrida, v_atual.status, v_nova.status, p_origem, v_uid, p_obs, v_nova.fornecedor_id);
  return v_nova;
end $$;

-- Nota do passageiro (só corrida concluída, uma vez; o servidor confere quem é o passageiro)
create or replace function fn_avaliar_corrida(p_corrida uuid, p_nota int, p_comentario text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_nota not between 1 and 5 then raise exception 'Nota de 1 a 5'; end if;
  update corridas set avaliacao = p_nota, avaliacao_comentario = nullif(left(btrim(coalesce(p_comentario, '')), 500), ''), avaliada_em = now()
   where id = p_corrida and status in ('concluida', 'validada', 'contestada') and avaliacao is null;
  if not found then return false; end if;
  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, observacao, fornecedor_id)
  select id, status, status, 'bot', format('Avaliação do passageiro: %s de 5%s', p_nota, coalesce(': ' || avaliacao_comentario, '')), fornecedor_id
    from corridas where id = p_corrida;
  return true;
end $$;
revoke execute on function fn_avaliar_corrida(uuid, int, text) from public, anon, authenticated;
grant execute on function fn_avaliar_corrida(uuid, int, text) to service_role;

-- ---------- Feriados ----------
create table if not exists feriados (
  data date primary key,
  nome text not null,
  criado_em timestamptz not null default now());
alter table feriados enable row level security;
drop policy if exists feriados_ler on feriados;
create policy feriados_ler on feriados for select using (is_usuario());
drop policy if exists feriados_planejamento on feriados;
create policy feriados_planejamento on feriados for all using (is_planejamento()) with check (is_planejamento());
grant select on feriados to authenticated;
grant insert, update, delete on feriados to authenticated;
grant all on feriados to service_role;

-- Feriados nacionais de 2026 e 2027 (os municipais de Extrema e os pontos facultativos: cadastre em Cadastros › Feriados)
insert into feriados (data, nome) values
  ('2026-01-01', 'Confraternização Universal'), ('2026-02-16', 'Carnaval'), ('2026-02-17', 'Carnaval'), ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'), ('2026-05-01', 'Dia do Trabalho'), ('2026-06-04', 'Corpus Christi'), ('2026-09-07', 'Independência'),
  ('2026-10-12', 'Nossa Senhora Aparecida'), ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Consciência Negra'), ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'), ('2027-02-08', 'Carnaval'), ('2027-02-09', 'Carnaval'), ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'), ('2027-05-01', 'Dia do Trabalho'), ('2027-05-27', 'Corpus Christi'), ('2027-09-07', 'Independência'),
  ('2027-10-12', 'Nossa Senhora Aparecida'), ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Consciência Negra'), ('2027-12-25', 'Natal')
on conflict (data) do nothing;

-- Dias úteis sem fins de semana e sem os feriados cadastrados
create or replace function fn_fim_dia_util(p_inicio timestamptz, p_n int) returns timestamptz
language plpgsql stable set search_path = public as $$
declare d date := (p_inicio at time zone 'America/Sao_Paulo')::date; n int := 0;
begin
  while n < p_n loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists (select 1 from feriados f where f.data = d) then n := n + 1; end if;
  end loop;
  return ((d + 1)::timestamp at time zone 'America/Sao_Paulo') - interval '1 second';
end $$;

-- ---------- Relatório: qualidade dos fornecedores e gasto por setor ----------
-- Pontualidade: chegada real (motorista chegou; sem ela, o embarque) contra a prevista (informada no aceite;
-- sem ela, o horário da corrida agendada), com a tolerância do parâmetro pontualidade_tolerancia_min.
create or replace function fn_relatorio_qualidade(
  p_de timestamptz, p_ate timestamptz, p_fornecedor uuid default null, p_solicitante uuid default null
) returns jsonb language sql stable set search_path = public as $$
  with base as (
    select c.*,
      coalesce(c.chegou_em, (select min(e.criado_em) from corrida_eventos e where e.corrida_id = c.id and e.status_novo = 'em_andamento')) as chegada_real,
      coalesce(c.chegada_prevista_em, case when c.tipo = 'agendada' then c.data_hora_prevista end) as chegada_prev
    from corridas c
    where c.data_hora_prevista between p_de and p_ate
      and (p_fornecedor is null or c.fornecedor_id = p_fornecedor)
      and (p_solicitante is null or c.solicitante_id = p_solicitante)
  ), feitas as (
    select b.*, extract(epoch from b.chegada_real - b.chegada_prev) / 60 as atraso_min
    from base b where b.status in ('concluida', 'validada', 'contestada', 'em_andamento')
  ), tol as (select fn_param_num('pontualidade_tolerancia_min', 5) as min)
  select jsonb_build_object(
    'fornecedores', coalesce((select jsonb_agg(x order by x->>'nome') from (
      select jsonb_build_object(
        'id', f.id, 'nome', f.nome,
        'feitas', count(k.*),
        'medidas', count(k.atraso_min),
        'no_horario', count(*) filter (where k.atraso_min <= (select min from tol)),
        'atraso_medio_min', round(avg(greatest(k.atraso_min, 0)) filter (where k.atraso_min is not null)::numeric, 1),
        'avaliacoes', count(k.avaliacao),
        'nota_media', round(avg(k.avaliacao)::numeric, 2),
        'notas_baixas', count(*) filter (where k.avaliacao <= 2),
        'canceladas_fornecedor', (select count(*) from base b2 where b2.fornecedor_id = f.id and b2.status = 'cancelada'
           and b2.motivo_cancelamento ilike '%fornecedor%'),
        'contestacoes', (select count(*) from espelho_itens i join base b3 on b3.id = i.corrida_id where b3.fornecedor_id = f.id and i.contestacao_status is not null)
      ) x
      from fornecedores f join feitas k on k.fornecedor_id = f.id
      group by f.id, f.nome) y), '[]'::jsonb),
    'por_setor', coalesce((select jsonb_agg(x order by (x->>'valor')::numeric desc) from (
      select jsonb_build_object(
        'setor', coalesce(nullif(btrim(s.setor), ''), 'Sem setor'),
        'pessoas', count(distinct b.solicitante_id),
        'corridas', count(*),
        'canceladas', count(*) filter (where b.status = 'cancelada'),
        'concluidas', count(*) filter (where b.status in ('concluida', 'validada', 'contestada')),
        'km', coalesce(round(sum(b.distancia_km) filter (where b.status in ('concluida', 'validada', 'contestada'))::numeric, 1), 0),
        'valor', coalesce(sum(coalesce(b.valor_faturado, b.valor_tabela, b.valor_informado)) filter (where b.status in ('concluida', 'validada', 'contestada')), 0)
      ) x
      from base b join solicitantes s on s.id = b.solicitante_id
      group by coalesce(nullif(btrim(s.setor), ''), 'Sem setor')) y), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('protocolo', b.protocolo, 'nota', b.avaliacao, 'comentario', b.avaliacao_comentario,
        'fornecedor', (select nome from fornecedores where id = b.fornecedor_id), 'quando', b.avaliada_em) order by b.avaliada_em desc)
      from (select * from base where avaliacao is not null and (avaliacao <= 3 or avaliacao_comentario is not null) order by avaliada_em desc limit 30) b), '[]'::jsonb)
  )
$$;
revoke execute on function fn_relatorio_qualidade(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function fn_relatorio_qualidade(timestamptz, timestamptz, uuid, uuid) to authenticated, service_role;
