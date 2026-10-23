-- 005: locais frequentes no app de pedido.
-- Todas as unidades com endereço e os locais cadastrados (hospital, aeroporto, cliente…) aparecem para a pessoa escolher
-- como origem ou destino. As coordenadas são preenchidas sozinhas pelo app na primeira vez que o local aparece.
-- Rode uma vez no SQL Editor do Supabase, depois de 004_acesso_fornecedor.sql.

create table if not exists locais (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  endereco text not null,
  lat double precision,
  lng double precision,
  ativo boolean not null default true,
  criado_em timestamptz not null default now());

alter table unidades add column if not exists lat double precision;
alter table unidades add column if not exists lng double precision;

-- Endereço mudou: as coordenadas antigas deixam de valer e são buscadas de novo
create or replace function fn_locais_limpar_coordenadas() returns trigger language plpgsql as $$
begin
  if new.endereco is distinct from old.endereco and new.lat is not distinct from old.lat then new.lat := null; new.lng := null; end if;
  return new;
end $$;
create or replace function fn_unidades_limpar_coordenadas() returns trigger language plpgsql as $$
begin
  if new.endereco_padrao is distinct from old.endereco_padrao and new.lat is not distinct from old.lat then new.lat := null; new.lng := null; end if;
  return new;
end $$;
drop trigger if exists locais_coordenadas on locais;
create trigger locais_coordenadas before update on locais for each row execute function fn_locais_limpar_coordenadas();
drop trigger if exists unidades_coordenadas on unidades;
create trigger unidades_coordenadas before update on unidades for each row execute function fn_unidades_limpar_coordenadas();

alter table locais enable row level security;
drop policy if exists locais_ler on locais;
create policy locais_ler on locais for select using (is_usuario());
drop policy if exists locais_admin on locais;
create policy locais_admin on locais for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on locais to authenticated;
grant all on locais to service_role;
