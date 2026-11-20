-- 020: segurança, LGPD e desempenho.
--   * Código de acesso do solicitante (4 números) para usar o link de pedido num aparelho novo, quando o
--     parâmetro pedido_exige_codigo = sim (desligado por padrão).
--   * Retenção: mensagens, conversas e coordenadas mais antigas que retencao_meses são apagadas (0 = nunca).
--   * Cache de rotas (30 dias), índices e atualização em tempo real do painel.
-- Rode uma vez no SQL Editor do Supabase, depois da 019.
begin;

-- ---------- Código de acesso do solicitante ----------
alter table solicitantes add column if not exists codigo_acesso text default lpad((floor(random() * 10000))::int::text, 4, '0');
update solicitantes set codigo_acesso = lpad((floor(random() * 10000))::int::text, 4, '0') where codigo_acesso is null;
alter table solicitantes drop constraint if exists solicitantes_codigo_acesso_formato;
alter table solicitantes add constraint solicitantes_codigo_acesso_formato check (codigo_acesso ~ '^[0-9]{4}$');
comment on column solicitantes.codigo_acesso is 'Código de 4 números pedido no link de pedido num aparelho novo (com pedido_exige_codigo = sim)';

insert into parametros (chave, valor, descricao) values
  ('pedido_exige_codigo', 'nao', 'sim = o link de pedido pede o código de 4 números do solicitante na primeira vez em cada aparelho'),
  ('retencao_meses', '12', 'Meses que mensagens do WhatsApp, conversas e localizações ficam guardadas (LGPD). 0 = guardar para sempre')
on conflict (chave) do nothing;

-- ---------- Retenção (LGPD) ----------
-- Apaga mensagens e conversas antigas e tira as coordenadas das corridas antigas. Roda uma vez por dia pelo agendador.
create or replace function fn_aplicar_retencao() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_meses int; v_limite timestamptz; n_msg int; n_conv int; n_corr int;
begin
  v_meses := coalesce(nullif(regexp_replace((select valor from parametros where chave = 'retencao_meses'), '\D', '', 'g'), '')::int, 12);
  if v_meses <= 0 then return jsonb_build_object('desligado', true); end if;
  v_limite := now() - make_interval(months => v_meses);
  delete from mensagens where criado_em < v_limite;
  get diagnostics n_msg = row_count;
  delete from conversas_bot where atualizado_em < v_limite;
  get diagnostics n_conv = row_count;
  update corridas set origem_lat = null, origem_lng = null, destino_lat = null, destino_lng = null,
    paradas = coalesce((select jsonb_agg(jsonb_build_object('texto', p->>'texto', 'lat', null, 'lng', null)) from jsonb_array_elements(paradas) p), '[]'::jsonb)
  where data_hora_prevista < v_limite and (origem_lat is not null or destino_lat is not null
    or exists (select 1 from jsonb_array_elements(paradas) p where p->>'lat' is not null));
  get diagnostics n_corr = row_count;
  return jsonb_build_object('mensagens', n_msg, 'conversas', n_conv, 'corridas_sem_coordenadas', n_corr);
end $$;
revoke execute on function fn_aplicar_retencao() from public, anon, authenticated;
grant execute on function fn_aplicar_retencao() to service_role;

-- ---------- Cache de rotas ----------
-- Distância do menor trajeto entre dois pontos (arredondados a ~10 m), guardada por 30 dias.
create table if not exists rotas_cache (
  chave text primary key,
  km numeric(10, 2) not null,
  fonte text not null,
  criado_em timestamptz not null default now());
alter table rotas_cache enable row level security;
grant all on rotas_cache to service_role;

-- ---------- Índices ----------
create index if not exists corridas_fornecedor_status on corridas (fornecedor_id, status);
create index if not exists mensagens_criado on mensagens (criado_em);
create index if not exists rotas_cache_criado on rotas_cache (criado_em);

-- ---------- Painel em tempo real ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'corridas') then
    alter publication supabase_realtime add table corridas;
  end if;
end $$;

commit;
