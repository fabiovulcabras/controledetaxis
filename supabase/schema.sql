-- ============ CONTROLE DE TÁXIS — schema Supabase ============
-- Rode este arquivo uma única vez no SQL Editor de um projeto novo.
-- As funções evitam "select ... into variavel" porque o SQL Editor do Supabase confunde essa forma com criação de tabela.
create extension if not exists pgcrypto;

create type perfil_usuario as enum ('admin','planejamento','consulta');
create type status_corrida as enum (
  'solicitada','enviada','aceita','recusada','sem_resposta','em_andamento','concluida','cancelada','validada','contestada');
create type origem_evento as enum ('bot','fornecedor','planejamento','sistema');

-- ---------- Usuários do painel ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  nome text not null,
  perfil perfil_usuario not null default 'consulta',
  ativo boolean not null default true);

-- ---------- Cadastros ----------
create table unidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  endereco_padrao text,
  ativo boolean not null default true);

create table centros_custo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null,
  unidade_id uuid references unidades,
  teto_por_corrida numeric(10,2) check (teto_por_corrida is null or teto_por_corrida > 0),
  ativo boolean not null default true);

-- Telefones sempre em dígitos, com DDI: 5511999998888
create table fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  telefone_whatsapp text not null unique check (telefone_whatsapp ~ '^[0-9]{10,15}$'),
  prioridade int not null default 1,
  prazo_resposta_min int not null default 10 check (prazo_resposta_min between 1 and 1440),
  ativo boolean not null default true);

create table solicitantes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  matricula text,
  setor text,
  telefone_whatsapp text not null unique check (telefone_whatsapp ~ '^[0-9]{10,15}$'),
  email text,
  unidade_id uuid references unidades,
  centro_custo_padrao_id uuid references centros_custo,
  fornecedor_padrao_id uuid references fornecedores,
  ativo boolean not null default true);

create table parametros (chave text primary key, valor text not null, descricao text);
insert into parametros (chave, valor, descricao) values
  ('planejamento_telefones', '', 'Números do planejamento que recebem avisos, separados por vírgula (ex.: 5511999998888)'),
  ('avisar_planejamento_toda_corrida', 'sim', '"sim" avisa o planejamento a cada corrida registrada; "nao" avisa só exceções'),
  ('prazo_agendada_min', '120', 'Prazo do fornecedor para responder corridas agendadas, em minutos'),
  ('antecedencia_maxima_dias', '30', 'Até quantos dias à frente uma corrida pode ser agendada'),
  ('conversa_expira_min', '15', 'Minutos sem resposta até o bot descartar uma solicitação incompleta'),
  ('lembrete_antecedencia_min', '60', 'Minutos antes da corrida agendada para lembrar o solicitante'),
  ('tolerancia_pct', '5', 'Diferença percentual aceita entre valor informado e faturado'),
  ('tolerancia_valor', '5.00', 'Diferença em reais aceita entre valor informado e faturado (vale a maior das duas)');

-- ---------- Corridas ----------
create table protocolo_contador (ano int primary key, ultimo int not null);

create function fn_novo_protocolo() returns text language plpgsql security definer set search_path = public as $$
declare v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int; v_num int;
begin
  insert into protocolo_contador as c (ano, ultimo) values (v_ano, 1)
  on conflict (ano) do update set ultimo = c.ultimo + 1
  returning ultimo into v_num;
  return 'TX-' || v_ano || '-' || lpad(v_num::text, 5, '0');
end $$;

create table corridas (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique default fn_novo_protocolo(),
  solicitante_id uuid not null references solicitantes,
  fornecedor_id uuid references fornecedores,
  centro_custo_id uuid references centros_custo,
  tipo text not null default 'imediata' check (tipo in ('imediata','agendada')),
  data_hora_prevista timestamptz not null,
  origem text not null,
  destino text not null,
  origem_lat numeric, origem_lng numeric, destino_lat numeric, destino_lng numeric,
  qtd_passageiros int not null default 1 check (qtd_passageiros between 1 and 20),
  outros_passageiros text,
  motivo text not null,
  status status_corrida not null default 'solicitada',
  motorista text,
  veiculo_placa text,
  eta_minutos int,
  valor_informado numeric(10,2) check (valor_informado is null or valor_informado >= 0),
  valor_faturado numeric(10,2),
  prazo_resposta_em timestamptz,
  lembrete_enviado_em timestamptz,
  motivo_recusa text,
  motivo_cancelamento text,
  validado_por uuid references profiles,
  validado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now());
create index on corridas (status, data_hora_prevista);
create index on corridas (fornecedor_id, data_hora_prevista);
create index on corridas (solicitante_id, criado_em desc);
create index on corridas (criado_em desc);

create table corrida_eventos (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references corridas on delete cascade,
  status_anterior status_corrida,
  status_novo status_corrida not null,
  origem origem_evento not null,
  usuario_id uuid references profiles,
  observacao text,
  criado_em timestamptz not null default now());
create index on corrida_eventos (corrida_id, criado_em);

-- Toda mensagem trocada pelo número da empresa (real ou simulada)
create table mensagens (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid references corridas on delete set null,
  direcao text not null check (direcao in ('entrada','saida')),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','simulado')),
  telefone text not null,
  template text,
  conteudo jsonb not null,
  wa_message_id text,
  status_envio text,
  erro text,
  criado_em timestamptz not null default now());
create index on mensagens (telefone, criado_em);
create index on mensagens (corrida_id);
create unique index mensagens_entrada_unica on mensagens (wa_message_id) where direcao = 'entrada' and wa_message_id is not null;

-- Estado da conversa do bot por telefone (solicitante ou fornecedor)
create table conversas_bot (
  telefone text primary key,
  etapa text not null,
  dados jsonb not null default '{}',
  atualizado_em timestamptz not null default now());

-- ---------- Faturas ----------
create table faturas (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references fornecedores,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  numero_nf text,
  valor_total numeric(12,2) not null default 0,
  status text not null default 'importada' check (status in ('importada','em_conciliacao','conciliada')),
  criado_por uuid default auth.uid() references profiles,
  criado_em timestamptz not null default now());

create table fatura_itens (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references faturas on delete cascade,
  data_corrida date,
  protocolo_informado text,
  descricao text,
  valor numeric(10,2) not null check (valor >= 0),
  corrida_id uuid references corridas,
  situacao text check (situacao in ('conciliado','divergente','sem_valor','sem_protocolo','cancelada','duplicado','outro_fornecedor')),
  decisao text check (decisao in ('aceito','contestado')),
  observacao text,
  decidido_por uuid references profiles,
  decidido_em timestamptz);
create index on fatura_itens (fatura_id);
create index on fatura_itens (corrida_id);

-- ---------- Permissões ----------
create function is_usuario() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and ativo) $$;
create function is_planejamento() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and ativo and perfil in ('admin','planejamento')) $$;
create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and ativo and perfil = 'admin') $$;

-- Primeiro usuário vira admin; os demais entram como consulta (o admin ajusta em Cadastros > Usuários)
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nome, perfil)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          case when not exists (select 1 from profiles) then 'admin'::perfil_usuario else 'consulta'::perfil_usuario end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- Transições de status (espelhadas em lib/status.ts) ----------
create function fn_transicao_valida(de status_corrida, para status_corrida) returns boolean language sql immutable as $$
  select case de
    when 'solicitada'   then para in ('enviada','cancelada')
    when 'enviada'      then para in ('enviada','aceita','recusada','sem_resposta','cancelada')
    when 'aceita'       then para in ('em_andamento','concluida','cancelada')
    when 'recusada'     then para in ('enviada','cancelada')
    when 'sem_resposta' then para in ('enviada','aceita','recusada','cancelada')
    when 'em_andamento' then para in ('concluida','cancelada')
    when 'concluida'    then para in ('validada','contestada')
    when 'contestada'   then para in ('validada','concluida')
    when 'validada'     then para in ('contestada')
    else false end
$$;

create function trg_corridas_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not fn_transicao_valida(old.status, new.status) then
    raise exception 'Mudança de status não permitida: % → %', old.status, new.status;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger corridas_status before update on corridas for each row execute function trg_corridas_status();

create function trg_corridas_evento_inicial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, observacao)
  values (new.id, null, new.status, 'bot', 'Solicitação registrada');
  return new;
end $$;
create trigger corridas_evento_inicial after insert on corridas for each row execute function trg_corridas_evento_inicial();

/*
  Única porta para mudar uma corrida depois de criada.
  p_status null = só atualiza campos (ex.: dados do motorista) e registra o evento.
  p_campos aceita: fornecedor_id, motorista, veiculo_placa, eta_minutos, valor_informado, prazo_resposta_em,
  motivo_recusa, motivo_cancelamento, lembrete_enviado_em.
  Chamada pelo servidor (service role, sem usuário) ou por usuário do planejamento.
*/
create function fn_mudar_status(p_corrida uuid, p_status status_corrida, p_origem origem_evento,
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
    lembrete_enviado_em = case when p_campos ? 'lembrete_enviado_em' then (p_campos->>'lembrete_enviado_em')::timestamptz else lembrete_enviado_em end,
    validado_por = case when p_status = 'validada' then v_uid when p_status = 'contestada' then null else validado_por end,
    validado_em = case when p_status = 'validada' then now() when p_status = 'contestada' then null else validado_em end
  where id = p_corrida
  returning * into v_nova;

  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao)
  values (p_corrida, v_atual.status, v_nova.status, p_origem, v_uid, p_obs);
  return v_nova;
end $$;

-- ---------- Conciliação ----------
create function fn_param_num(p_chave text, p_padrao numeric) returns numeric language sql stable security definer set search_path = public as
$$ select coalesce((select nullif(replace(btrim(valor), ',', '.'), '')::numeric from parametros where chave = p_chave), p_padrao) $$;

-- Cruza cada item da fatura com as corridas pelo protocolo e classifica a situação. Pode ser rodada de novo.
create function fn_conciliar_fatura(p_fatura uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fat faturas; r record; v_c corridas; v_sit text; v_pct numeric; v_abs numeric; v_tol numeric;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para conciliar faturas'; end if;
  v_fat := (select f from faturas f where f.id = p_fatura);
  if v_fat.id is null then raise exception 'Fatura não encontrada'; end if;
  v_pct := fn_param_num('tolerancia_pct', 5);
  v_abs := fn_param_num('tolerancia_valor', 5);

  for r in select * from fatura_itens where fatura_id = p_fatura order by data_corrida nulls last, id loop
    v_c := null;
    if coalesce(btrim(r.protocolo_informado), '') <> '' then
      v_c := (select c from corridas c where c.protocolo = upper(btrim(r.protocolo_informado)));
    end if;

    if v_c.id is null then v_sit := 'sem_protocolo';
    elsif v_c.fornecedor_id is distinct from v_fat.fornecedor_id then v_sit := 'outro_fornecedor';
    elsif exists (select 1 from fatura_itens o where o.corrida_id = v_c.id and o.id <> r.id
                  and (o.fatura_id <> p_fatura or o.id < r.id)) then v_sit := 'duplicado';
    elsif v_c.status = 'cancelada' then v_sit := 'cancelada';
    elsif v_c.valor_informado is null then v_sit := 'sem_valor';
    else
      v_tol := greatest(v_abs, v_c.valor_informado * v_pct / 100);
      v_sit := case when abs(r.valor - v_c.valor_informado) <= v_tol then 'conciliado' else 'divergente' end;
    end if;

    update fatura_itens set corrida_id = v_c.id, situacao = v_sit where id = r.id;
    if v_c.id is not null and v_sit not in ('duplicado','outro_fornecedor') then
      update corridas set valor_faturado = r.valor where id = v_c.id;
    end if;
  end loop;

  update faturas set status = 'em_conciliacao',
    valor_total = (select coalesce(sum(valor), 0) from fatura_itens where fatura_id = p_fatura)
  where id = p_fatura;

  return (select jsonb_object_agg(situacao, n) from (
    select situacao, count(*) n from fatura_itens where fatura_id = p_fatura group by situacao) s);
end $$;

-- Aceitar valida a corrida; contestar marca a corrida como contestada. Itens conciliados podem ser aceitos em lote.
create function fn_decidir_item(p_item uuid, p_decisao text, p_obs text default null) returns void language plpgsql security definer set search_path = public as $$
declare v_item fatura_itens; v_c corridas;
begin
  if not is_planejamento() then raise exception 'Sem permissão para decidir itens da fatura'; end if;
  if p_decisao not in ('aceito','contestado') then raise exception 'Decisão inválida'; end if;
  v_item := (select i from fatura_itens i where i.id = p_item for update);
  if v_item.id is null then raise exception 'Item não encontrado'; end if;
  if v_item.situacao is null then raise exception 'Concilie a fatura antes de decidir os itens'; end if;
  if p_decisao = 'contestado' and coalesce(btrim(p_obs), '') = '' and v_item.situacao = 'conciliado' then
    raise exception 'Informe o motivo para contestar um item conciliado';
  end if;

  update fatura_itens set decisao = p_decisao, observacao = coalesce(p_obs, observacao),
    decidido_por = auth.uid(), decidido_em = now() where id = p_item;

  if v_item.corrida_id is not null then
    v_c := (select c from corridas c where c.id = v_item.corrida_id);
    if p_decisao = 'aceito' and v_c.status in ('concluida','contestada') then
      perform fn_mudar_status(v_c.id, 'validada', 'planejamento', coalesce(p_obs, 'Aceita na conciliação da fatura'));
    elsif p_decisao = 'contestado' and v_c.status in ('concluida','validada') then
      perform fn_mudar_status(v_c.id, 'contestada', 'planejamento', coalesce(p_obs, 'Contestada na conciliação da fatura'));
    end if;
  end if;

  if not exists (select 1 from fatura_itens where fatura_id = v_item.fatura_id and decisao is null) then
    update faturas set status = 'conciliada' where id = v_item.fatura_id;
  end if;
end $$;

-- Funções que mudam dados não ficam disponíveis para visitantes sem login
revoke execute on function fn_mudar_status(uuid, status_corrida, origem_evento, text, jsonb) from public, anon;
revoke execute on function fn_conciliar_fatura(uuid) from public, anon;
revoke execute on function fn_decidir_item(uuid, text, text) from public, anon;
revoke execute on function fn_novo_protocolo() from public, anon, authenticated;
grant execute on function fn_mudar_status(uuid, status_corrida, origem_evento, text, jsonb) to authenticated, service_role;
grant execute on function fn_conciliar_fatura(uuid) to authenticated, service_role;
grant execute on function fn_decidir_item(uuid, text, text) to authenticated, service_role;
grant execute on function fn_novo_protocolo() to service_role;

-- ---------- Row Level Security ----------
alter table profiles enable row level security;
alter table unidades enable row level security;
alter table centros_custo enable row level security;
alter table fornecedores enable row level security;
alter table solicitantes enable row level security;
alter table parametros enable row level security;
alter table protocolo_contador enable row level security;
alter table corridas enable row level security;
alter table corrida_eventos enable row level security;
alter table mensagens enable row level security;
alter table conversas_bot enable row level security;
alter table faturas enable row level security;
alter table fatura_itens enable row level security;

create policy profiles_ler on profiles for select using (id = auth.uid() or is_usuario());
create policy profiles_admin on profiles for update using (is_admin()) with check (is_admin());

create policy unidades_ler on unidades for select using (is_usuario());
create policy unidades_admin on unidades for all using (is_admin()) with check (is_admin());
create policy cc_ler on centros_custo for select using (is_usuario());
create policy cc_admin on centros_custo for all using (is_admin()) with check (is_admin());
create policy fornecedores_ler on fornecedores for select using (is_usuario());
create policy fornecedores_admin on fornecedores for all using (is_admin()) with check (is_admin());
create policy solicitantes_ler on solicitantes for select using (is_usuario());
create policy solicitantes_admin on solicitantes for all using (is_admin()) with check (is_admin());
create policy parametros_ler on parametros for select using (is_usuario());
create policy parametros_admin on parametros for update using (is_admin()) with check (is_admin());

-- Corridas, eventos e mensagens só mudam pelo servidor ou pelas funções acima
create policy corridas_ler on corridas for select using (is_usuario());
create policy eventos_ler on corrida_eventos for select using (is_usuario());
create policy mensagens_ler on mensagens for select using (is_usuario());

create policy faturas_ler on faturas for select using (is_usuario());
create policy faturas_planejamento on faturas for all using (is_planejamento()) with check (is_planejamento());
create policy itens_ler on fatura_itens for select using (is_usuario());
create policy itens_planejamento on fatura_itens for all using (is_planejamento()) with check (is_planejamento());
-- protocolo_contador e conversas_bot: sem políticas = só o servidor (service role) acessa
