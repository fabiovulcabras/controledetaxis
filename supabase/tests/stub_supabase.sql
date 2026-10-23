-- Simula o mínimo do Supabase num Postgres comum: papéis, privilégios padrão e o esquema auth.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
-- O usuário logado vem da configuração t.uid (select set_config('t.uid', '<uuid>', false)).
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('t.uid', true), '')::uuid $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
