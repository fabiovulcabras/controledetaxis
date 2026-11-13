-- 015: fechamento mensal por espelho.
--   1. Extras na corrida (pedágio, espera, km a mais, parada extra) com comprovante; o planejamento aprova ou recusa.
--   2. Espelho do mês por fornecedor: corridas concluídas pelo valor de tabela (sem tabela, o informado) + extras aprovados.
--      O fornecedor confere no portal, aprova ou contesta item a item; o planejamento decide e reemite.
--      Sem resposta, lembrete no 3º dia útil e aprovação tácita no fim do 5º.
--   3. NF (número, valor, PDF) enviada pelo fornecedor e pagamento marcado pelo planejamento.
-- Rode uma vez no SQL Editor do Supabase, depois de 014_conciliacao_tabela.sql.
begin;

-- ---------- Dias úteis (segunda a sexta, horário de São Paulo) ----------
-- Fim (23:59:59) do n-ésimo dia útil depois do dia de p_inicio.
create or replace function fn_fim_dia_util(p_inicio timestamptz, p_n int) returns timestamptz
language plpgsql immutable as $$
declare d date := (p_inicio at time zone 'America/Sao_Paulo')::date; n int := 0;
begin
  while n < p_n loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return ((d + 1)::timestamp at time zone 'America/Sao_Paulo') - interval '1 second';
end $$;

-- ---------- Arquivos (comprovantes e NF) ----------
-- Bucket privado do Supabase Storage. Só o servidor grava e gera links temporários para abrir.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false) on conflict (id) do nothing;
  end if;
end $$;

-- ---------- Espelhos ----------
create table if not exists espelhos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references fornecedores,
  competencia text not null check (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'aguardando' check (status in ('aguardando','contestado','aprovado','nf_enviada','pago')),
  versao int not null default 1,
  total numeric(12,2) not null default 0,
  enviado_em timestamptz,
  lembrete_em timestamptz,
  lembrete_enviado_em timestamptz,
  prazo_em timestamptz,
  aprovado_em timestamptz,
  aprovacao text check (aprovacao in ('fornecedor','tacita')),
  nf_numero text,
  nf_valor numeric(12,2),
  nf_arquivo text,
  nf_enviada_em timestamptz,
  pago_em date,
  pago_por uuid references profiles,
  gerado_por uuid references profiles,
  criado_em timestamptz not null default now(),
  unique (fornecedor_id, competencia));

create table if not exists espelho_itens (
  id uuid primary key default gen_random_uuid(),
  espelho_id uuid not null references espelhos on delete cascade,
  corrida_id uuid not null unique references corridas,
  valor_informado numeric(10,2),
  valor_tabela numeric(10,2),
  valor_base numeric(10,2) not null default 0,
  base_origem text not null check (base_origem in ('tabela','informado','sem_valor')),
  conferir boolean not null default false,
  ajuste_obs text,
  valor_extras numeric(10,2) not null default 0,
  valor_final numeric(10,2) not null default 0,
  contestacao_status text check (contestacao_status in ('contestado','aceita','mantida')),
  contestacao_motivo text,
  contestacao_valor numeric(10,2),
  contestacao_resposta text,
  contestado_em timestamptz,
  decidido_por uuid references profiles,
  decidido_em timestamptz);
create index if not exists espelho_itens_espelho on espelho_itens (espelho_id);

create table if not exists espelho_eventos (
  id uuid primary key default gen_random_uuid(),
  espelho_id uuid not null references espelhos on delete cascade,
  origem text not null check (origem in ('planejamento','fornecedor','sistema')),
  tipo text not null,
  descricao text,
  usuario_id uuid references profiles,
  criado_em timestamptz not null default now());
create index if not exists espelho_eventos_espelho on espelho_eventos (espelho_id, criado_em);

-- ---------- Extras ----------
create table if not exists corrida_extras (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references corridas on delete cascade,
  tipo text not null check (tipo in ('pedagio','espera','km_extra','parada_extra','outro')),
  descricao text,
  valor numeric(10,2) not null check (valor > 0),
  comprovante text,
  status text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  motivo_recusa text,
  decidido_por uuid references profiles,
  decidido_em timestamptz,
  espelho_id uuid references espelhos on delete set null,
  criado_em timestamptz not null default now());
create index if not exists corrida_extras_corrida on corrida_extras (corrida_id);
create index if not exists corrida_extras_pendentes on corrida_extras (status) where status = 'pendente';

-- Extra só até a corrida entrar num espelho
create or replace function trg_extra_antes_do_espelho() returns trigger language plpgsql as $$
begin
  if exists (select 1 from espelho_itens where corrida_id = new.corrida_id) then
    raise exception 'Esta corrida já está no espelho do mês. Para cobrar um extra, conteste o item no espelho.';
  end if;
  return new;
end $$;
drop trigger if exists extra_antes_do_espelho on corrida_extras;
create trigger extra_antes_do_espelho before insert on corrida_extras for each row execute function trg_extra_antes_do_espelho();

-- ---------- Funções auxiliares ----------
create or replace function fn_espelho_evento(p_espelho uuid, p_origem text, p_tipo text, p_descricao text) returns void
language sql security definer set search_path = public as $$
  insert into espelho_eventos (espelho_id, origem, tipo, descricao, usuario_id) values (p_espelho, p_origem, p_tipo, p_descricao, auth.uid());
$$;

create or replace function fn_espelho_recalcular(p_espelho uuid) returns void language sql security definer set search_path = public as $$
  update espelho_itens set valor_final = case when contestacao_status = 'aceita' then contestacao_valor else valor_base + valor_extras end
  where espelho_id = p_espelho;
  update espelhos set total = (select coalesce(sum(valor_final), 0) from espelho_itens where espelho_id = p_espelho) where id = p_espelho;
$$;

create or replace function fn_brl(v numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

-- ---------- 1. Extras ----------
create or replace function fn_decidir_extra(p_extra uuid, p_decisao text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v corrida_extras;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para decidir extras'; end if;
  v := (select e from corrida_extras e where e.id = p_extra for update);
  if v.id is null then raise exception 'Extra não encontrado'; end if;
  if v.espelho_id is not null then raise exception 'Este extra já está num espelho e não pode mais ser alterado'; end if;
  if p_decisao not in ('aprovado','recusado') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'recusado' and coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa'; end if;
  update corrida_extras set status = p_decisao, motivo_recusa = case when p_decisao = 'recusado' then btrim(p_motivo) end,
    decidido_por = auth.uid(), decidido_em = now() where id = p_extra;
end $$;

-- ---------- 2. Espelho ----------
create or replace function fn_gerar_espelho(p_fornecedor uuid, p_competencia text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_inicio timestamptz; v_fim timestamptz; v_pend int; v_n int;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para gerar espelhos'; end if;
  if p_competencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Competência inválida'; end if;
  if exists (select 1 from espelhos where fornecedor_id = p_fornecedor and competencia = p_competencia) then
    raise exception 'Já existe espelho deste fornecedor para %', p_competencia;
  end if;
  v_inicio := ((p_competencia || '-01')::date)::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (((p_competencia || '-01')::date + interval '1 month')::date)::timestamp at time zone 'America/Sao_Paulo';

  select count(*) into v_pend from corrida_extras e join corridas c on c.id = e.corrida_id
  where c.fornecedor_id = p_fornecedor and c.data_hora_prevista >= v_inicio and c.data_hora_prevista < v_fim
    and e.status = 'pendente' and e.espelho_id is null;
  if v_pend > 0 then raise exception 'Há % extra(s) aguardando decisão neste mês. Aprove ou recuse antes de gerar o espelho.', v_pend; end if;

  insert into espelhos (fornecedor_id, competencia, gerado_por, enviado_em, lembrete_em, prazo_em)
  values (p_fornecedor, p_competencia, auth.uid(), now(), fn_fim_dia_util(now(), 2) + interval '1 second', fn_fim_dia_util(now(), 5))
  returning id into v_id;

  insert into espelho_itens (espelho_id, corrida_id, valor_informado, valor_tabela, valor_base, base_origem, conferir)
  select v_id, c.id, c.valor_informado, t.tab,
    coalesce(t.tab, c.valor_informado, 0),
    case when t.tab is not null then 'tabela' when c.valor_informado is not null then 'informado' else 'sem_valor' end,
    t.tab is null
  from corridas c
  cross join lateral (select case when c.valor_tabela is not null and c.preco_fornecedor_id = p_fornecedor then c.valor_tabela end as tab) t
  where c.fornecedor_id = p_fornecedor and c.status in ('concluida','validada','contestada')
    and c.data_hora_prevista >= v_inicio and c.data_hora_prevista < v_fim
    and not exists (select 1 from espelho_itens i where i.corrida_id = c.id);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nenhuma corrida concluída deste fornecedor em % fora de outro espelho', p_competencia; end if;

  -- Extras do mês ficam presos ao espelho; só os aprovados somam
  update corrida_extras e set espelho_id = v_id from espelho_itens i where i.espelho_id = v_id and e.corrida_id = i.corrida_id;
  update espelho_itens i set valor_extras = coalesce((select sum(valor) from corrida_extras e where e.corrida_id = i.corrida_id and e.status = 'aprovado'), 0)
  where i.espelho_id = v_id;
  perform fn_espelho_recalcular(v_id);
  perform fn_espelho_evento(v_id, case when auth.uid() is null then 'sistema' else 'planejamento' end, 'gerado',
    format('Espelho gerado com %s corrida(s), total %s', v_n, fn_brl((select total from espelhos where id = v_id))));
  return v_id;
end $$;

-- Planejamento ajusta o valor de um item (ex.: corrida sem tabela conferida) antes da aprovação
create or replace function fn_ajustar_item_espelho(p_item uuid, p_valor numeric, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare v espelho_itens; v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para ajustar espelhos'; end if;
  v := (select i from espelho_itens i where i.id = p_item for update);
  if v.id is null then raise exception 'Item não encontrado'; end if;
  v_esp := (select e from espelhos e where e.id = v.espelho_id);
  if v_esp.status not in ('aguardando','contestado') then raise exception 'O espelho já foi aprovado; não dá mais para ajustar'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Valor inválido'; end if;
  if p_valor <> v.valor_base and coalesce(btrim(p_obs), '') = '' then raise exception 'Informe o motivo do ajuste'; end if;
  update espelho_itens set valor_base = p_valor, conferir = false, ajuste_obs = coalesce(nullif(btrim(p_obs), ''), ajuste_obs) where id = p_item;
  perform fn_espelho_recalcular(v.espelho_id);
  perform fn_espelho_evento(v.espelho_id, 'planejamento', 'ajuste',
    format('%s: %s → %s%s', (select protocolo from corridas where id = v.corrida_id), fn_brl(v.valor_base), fn_brl(p_valor),
      coalesce(' (' || nullif(btrim(p_obs), '') || ')', '')));
end $$;

-- Fornecedor contesta itens (chamada só pelo servidor, depois de conferir o login do portal)
create or replace function fn_contestar_espelho(p_espelho uuid, p_itens jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos; r jsonb; v espelho_itens; v_n int := 0;
begin
  if auth.uid() is not null then raise exception 'Só o fornecedor contesta, pelo portal'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.id is null then raise exception 'Espelho não encontrado'; end if;
  if v_esp.status <> 'aguardando' then raise exception 'Este espelho não está aguardando conferência'; end if;
  if now() > v_esp.prazo_em then raise exception 'O prazo para conferir este espelho terminou'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v := (select i from espelho_itens i where i.id = (r->>'id')::uuid and i.espelho_id = p_espelho for update);
    if v.id is null then raise exception 'Item não encontrado no espelho'; end if;
    if coalesce(btrim(r->>'motivo'), '') = '' then raise exception 'Informe o motivo de cada item contestado'; end if;
    if (r->>'valor') is null or (r->>'valor')::numeric < 0 then raise exception 'Informe o valor que você entende correto'; end if;
    update espelho_itens set contestacao_status = 'contestado', contestacao_motivo = left(btrim(r->>'motivo'), 500),
      contestacao_valor = round((r->>'valor')::numeric, 2), contestacao_resposta = null, contestado_em = now(),
      decidido_por = null, decidido_em = null
    where id = v.id;
    perform fn_espelho_evento(p_espelho, 'fornecedor', 'contestacao',
      format('%s: pede %s (espelho %s). Motivo: %s', (select protocolo from corridas where id = v.corrida_id),
        fn_brl((r->>'valor')::numeric), fn_brl(v.valor_final), btrim(r->>'motivo')));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Escolha ao menos um item para contestar'; end if;
  update espelhos set status = 'contestado' where id = p_espelho;
end $$;

create or replace function fn_decidir_contestacao(p_item uuid, p_decisao text, p_resposta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v espelho_itens; v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para decidir contestações'; end if;
  v := (select i from espelho_itens i where i.id = p_item for update);
  if v.id is null then raise exception 'Item não encontrado'; end if;
  v_esp := (select e from espelhos e where e.id = v.espelho_id);
  if v_esp.status <> 'contestado' or v.contestacao_status <> 'contestado' then raise exception 'Este item não está contestado'; end if;
  if p_decisao not in ('aceita','mantida') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'mantida' and coalesce(btrim(p_resposta), '') = '' then raise exception 'Explique ao fornecedor por que o valor foi mantido'; end if;
  update espelho_itens set contestacao_status = p_decisao, contestacao_resposta = nullif(btrim(p_resposta), ''),
    decidido_por = auth.uid(), decidido_em = now() where id = p_item;
  perform fn_espelho_recalcular(v.espelho_id);
  perform fn_espelho_evento(v.espelho_id, 'planejamento', 'decisao',
    format('%s: contestação %s%s', (select protocolo from corridas where id = v.corrida_id),
      case when p_decisao = 'aceita' then 'aceita, valor ' || fn_brl(v.contestacao_valor) else 'recusada, valor mantido' end,
      coalesce(' (' || nullif(btrim(p_resposta), '') || ')', '')));
end $$;

-- Depois de decidir todas as contestações, o planejamento reenvia o espelho ao fornecedor (novo prazo)
create or replace function fn_reemitir_espelho(p_espelho uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para reemitir espelhos'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.status <> 'contestado' then raise exception 'Só um espelho contestado pode ser reemitido'; end if;
  if exists (select 1 from espelho_itens where espelho_id = p_espelho and contestacao_status = 'contestado') then
    raise exception 'Decida todas as contestações antes de reenviar';
  end if;
  update espelhos set status = 'aguardando', versao = versao + 1, enviado_em = now(), lembrete_enviado_em = null,
    lembrete_em = fn_fim_dia_util(now(), 2) + interval '1 second', prazo_em = fn_fim_dia_util(now(), 5)
  where id = p_espelho;
  perform fn_espelho_evento(p_espelho, 'planejamento', 'reemitido',
    format('Versão %s enviada ao fornecedor, total %s', v_esp.versao + 1, fn_brl(v_esp.total)));
end $$;

-- Aprovação pelo fornecedor (portal) ou tácita (agendador, depois do prazo). Só pelo servidor.
create or replace function fn_aprovar_espelho(p_espelho uuid, p_origem text) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos; r record;
begin
  if auth.uid() is not null then raise exception 'A aprovação é feita pelo fornecedor, no portal'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.id is null then raise exception 'Espelho não encontrado'; end if;
  if v_esp.status <> 'aguardando' then raise exception 'Este espelho não está aguardando conferência'; end if;
  if p_origem not in ('fornecedor','tacita') then raise exception 'Origem inválida'; end if;
  if p_origem = 'tacita' and now() < v_esp.prazo_em then raise exception 'O prazo do fornecedor ainda não terminou'; end if;
  if p_origem = 'fornecedor' and now() > v_esp.prazo_em then raise exception 'O prazo para conferir este espelho terminou'; end if;
  update espelhos set status = 'aprovado', aprovado_em = now(), aprovacao = p_origem where id = p_espelho;
  for r in select i.corrida_id, i.valor_final, c.status from espelho_itens i join corridas c on c.id = i.corrida_id where i.espelho_id = p_espelho loop
    update corridas set valor_faturado = r.valor_final where id = r.corrida_id;
    if r.status in ('concluida','contestada') then
      perform fn_mudar_status(r.corrida_id, 'validada', 'sistema', format('Aprovada no espelho %s', v_esp.competencia));
    end if;
  end loop;
  perform fn_espelho_evento(p_espelho, case when p_origem = 'fornecedor' then 'fornecedor' else 'sistema' end, 'aprovado',
    case when p_origem = 'fornecedor' then format('Aprovado pelo fornecedor, total %s', fn_brl(v_esp.total))
         else format('Aprovado automaticamente: sem resposta até o fim do 5º dia útil. Total %s', fn_brl(v_esp.total)) end);
end $$;

-- ---------- 3. NF e pagamento ----------
create or replace function fn_registrar_nf(p_espelho uuid, p_numero text, p_valor numeric, p_arquivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos;
begin
  if auth.uid() is not null then raise exception 'A NF é enviada pelo fornecedor, no portal'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.status not in ('aprovado','nf_enviada') then raise exception 'A NF só pode ser enviada depois do espelho aprovado e antes do pagamento'; end if;
  if coalesce(btrim(p_numero), '') = '' or p_valor is null or p_valor <= 0 or coalesce(p_arquivo, '') = '' then
    raise exception 'Informe número, valor e o PDF da NF';
  end if;
  update espelhos set status = 'nf_enviada', nf_numero = left(btrim(p_numero), 30), nf_valor = round(p_valor, 2),
    nf_arquivo = p_arquivo, nf_enviada_em = now() where id = p_espelho;
  perform fn_espelho_evento(p_espelho, 'fornecedor', 'nf',
    format('NF %s de %s enviada%s', btrim(p_numero), fn_brl(p_valor),
      case when abs(p_valor - v_esp.total) >= 0.01 then format(' — diferente do espelho (%s)', fn_brl(v_esp.total)) else ', igual ao espelho' end));
end $$;

create or replace function fn_marcar_pago(p_espelho uuid, p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para registrar pagamento'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.status <> 'nf_enviada' then raise exception 'Registre o pagamento depois que o fornecedor enviar a NF'; end if;
  if p_data is null or p_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de pagamento inválida'; end if;
  update espelhos set status = 'pago', pago_em = p_data, pago_por = auth.uid() where id = p_espelho;
  perform fn_espelho_evento(p_espelho, 'planejamento', 'pago', format('Pagamento registrado em %s', to_char(p_data, 'DD/MM/YYYY')));
end $$;

-- ---------- Permissões ----------
alter table espelhos enable row level security;
alter table espelho_itens enable row level security;
alter table espelho_eventos enable row level security;
alter table corrida_extras enable row level security;
drop policy if exists espelhos_ler on espelhos;
create policy espelhos_ler on espelhos for select using (is_usuario());
drop policy if exists espelho_itens_ler on espelho_itens;
create policy espelho_itens_ler on espelho_itens for select using (is_usuario());
drop policy if exists espelho_eventos_ler on espelho_eventos;
create policy espelho_eventos_ler on espelho_eventos for select using (is_usuario());
drop policy if exists corrida_extras_ler on corrida_extras;
create policy corrida_extras_ler on corrida_extras for select using (is_usuario());
grant select on espelhos, espelho_itens, espelho_eventos, corrida_extras to authenticated;
grant all on espelhos, espelho_itens, espelho_eventos, corrida_extras to service_role;

revoke execute on function fn_decidir_extra(uuid, text, text) from public, anon;
revoke execute on function fn_gerar_espelho(uuid, text) from public, anon;
revoke execute on function fn_ajustar_item_espelho(uuid, numeric, text) from public, anon;
revoke execute on function fn_contestar_espelho(uuid, jsonb) from public, anon, authenticated;
revoke execute on function fn_decidir_contestacao(uuid, text, text) from public, anon;
revoke execute on function fn_reemitir_espelho(uuid) from public, anon;
revoke execute on function fn_aprovar_espelho(uuid, text) from public, anon, authenticated;
revoke execute on function fn_registrar_nf(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function fn_marcar_pago(uuid, date) from public, anon;
revoke execute on function fn_espelho_evento(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function fn_espelho_recalcular(uuid) from public, anon, authenticated;
grant execute on function fn_decidir_extra(uuid, text, text), fn_gerar_espelho(uuid, text), fn_ajustar_item_espelho(uuid, numeric, text),
  fn_decidir_contestacao(uuid, text, text), fn_reemitir_espelho(uuid), fn_marcar_pago(uuid, date) to authenticated, service_role;
grant execute on function fn_contestar_espelho(uuid, jsonb), fn_aprovar_espelho(uuid, text), fn_registrar_nf(uuid, text, numeric, text),
  fn_espelho_evento(uuid, text, text, text), fn_espelho_recalcular(uuid) to service_role;

commit;
