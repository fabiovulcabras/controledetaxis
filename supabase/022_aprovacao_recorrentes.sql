-- 022: aprovação do gestor, corridas recorrentes, juntar e alterar corridas, MFA obrigatório (opcional).
-- Rode uma vez no SQL Editor do Supabase (depois da 021).

-- ---------- Aprovação ----------
alter table corridas add column if not exists aprovacao_status text check (aprovacao_status in ('pendente', 'aprovada', 'recusada'));
alter table corridas add column if not exists aprovacao_motivo text;
alter table corridas add column if not exists aprovacao_por uuid references profiles;
alter table corridas add column if not exists aprovacao_em timestamptz;
create index if not exists corridas_aprovacao_pendente on corridas (criado_em) where aprovacao_status = 'pendente';

insert into parametros (chave, valor, descricao) values
  ('aprovacao_valor_acima', '', 'Corrida com valor de tabela acima deste (R$) espera aprovação do planejamento antes de ir ao fornecedor. Vazio = não exige'),
  ('aprovacao_km_acima', '', 'Corrida com mais km que este espera aprovação. Vazio = não exige'),
  ('aprovacao_fora_horario', '', 'Corridas neste intervalo de horário esperam aprovação, ex.: 22:00-06:00. Vazio = não exige'),
  ('recorrente_antecedencia_horas', '24', 'Com quantas horas de antecedência as corridas recorrentes são geradas e enviadas ao fornecedor'),
  ('juntar_janela_min', '20', 'Sugestão de juntar corridas: mesma origem e horários com até estes minutos de diferença'),
  ('mfa_obrigatorio', 'nao', 'sim = admin e planejamento precisam do código do aplicativo autenticador (2 fatores) para usar o painel')
on conflict (chave) do nothing;

-- ---------- Corridas juntadas ----------
alter table corridas add column if not exists juntada_em uuid references corridas;

-- ---------- Corridas recorrentes ----------
create table if not exists corridas_recorrentes (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid not null references solicitantes,
  dias_semana smallint[] not null check (array_length(dias_semana, 1) between 1 and 7 and dias_semana <@ array[1,2,3,4,5,6,7]::smallint[]),
  hora time not null,
  origem text not null, origem_lat double precision, origem_lng double precision,
  destino text not null, destino_lat double precision, destino_lng double precision,
  paradas jsonb,
  qtd_passageiros int not null default 1 check (qtd_passageiros between 1 and 15),
  outros_passageiros text,
  motivo text not null,
  observacoes text,
  pular_feriados boolean not null default true,
  inicio date not null default current_date,
  fim date,
  ultima_data date,
  ativo boolean not null default true,
  criado_por uuid references profiles,
  criado_em timestamptz not null default now());
alter table corridas_recorrentes enable row level security;
drop policy if exists recorrentes_ler on corridas_recorrentes;
create policy recorrentes_ler on corridas_recorrentes for select using (is_usuario());
drop policy if exists recorrentes_planejamento on corridas_recorrentes;
create policy recorrentes_planejamento on corridas_recorrentes for all using (is_planejamento()) with check (is_planejamento());
grant select, insert, update, delete on corridas_recorrentes to authenticated;
grant all on corridas_recorrentes to service_role;
alter table corridas add column if not exists recorrente_id uuid references corridas_recorrentes on delete set null;

-- ---------- Status: novos campos (aprovação, alterar horário/destino, juntar) ----------
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
    aprovacao_status = case when p_campos ? 'aprovacao_status' then p_campos->>'aprovacao_status' else aprovacao_status end,
    aprovacao_motivo = case when p_campos ? 'aprovacao_motivo' then p_campos->>'aprovacao_motivo' else aprovacao_motivo end,
    data_hora_prevista = case when p_campos ? 'data_hora_prevista' then (p_campos->>'data_hora_prevista')::timestamptz else data_hora_prevista end,
    destino = case when p_campos ? 'destino' then p_campos->>'destino' else destino end,
    destino_lat = case when p_campos ? 'destino_lat' then (p_campos->>'destino_lat')::double precision else destino_lat end,
    destino_lng = case when p_campos ? 'destino_lng' then (p_campos->>'destino_lng')::double precision else destino_lng end,
    paradas = case when p_campos ? 'paradas' then nullif(p_campos->'paradas', 'null'::jsonb) else paradas end,
    qtd_passageiros = case when p_campos ? 'qtd_passageiros' then (p_campos->>'qtd_passageiros')::int else qtd_passageiros end,
    outros_passageiros = case when p_campos ? 'outros_passageiros' then p_campos->>'outros_passageiros' else outros_passageiros end,
    distancia_km = case when p_campos ? 'distancia_km' then (p_campos->>'distancia_km')::numeric else distancia_km end,
    preco_calculado_em = case when p_campos ? 'preco_calculado_em' then (p_campos->>'preco_calculado_em')::timestamptz else preco_calculado_em end,
    juntada_em = case when p_campos ? 'juntada_em' then (p_campos->>'juntada_em')::uuid else juntada_em end,
    validado_por = case when p_status = 'validada' then v_uid when p_status = 'contestada' then null else validado_por end,
    validado_em = case when p_status = 'validada' then now() when p_status = 'contestada' then null else validado_em end
  where id = p_corrida
  returning * into v_nova;

  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao, fornecedor_id)
  values (p_corrida, v_atual.status, v_nova.status, p_origem, v_uid, p_obs, v_nova.fornecedor_id);
  return v_nova;
end $$;

-- ---------- MFA (opcional) ----------
-- Com mfa_obrigatorio = sim, admin e planejamento só têm acesso com a sessão confirmada pelo 2º fator (aal2).
-- Perfil consulta não muda. Para desligar sem acesso ao painel: update parametros set valor = 'nao' where chave = 'mfa_obrigatorio';
create or replace function fn_mfa_ok() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select lower(btrim(valor)) from parametros where chave = 'mfa_obrigatorio'), 'nao') <> 'sim'
       or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' $$;
create or replace function is_planejamento() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and ativo and perfil in ('admin','planejamento')) and fn_mfa_ok() $$;
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and ativo and perfil = 'admin') and fn_mfa_ok() $$;
