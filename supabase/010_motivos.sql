-- 010: motivos de corrida cadastráveis (Cadastros › Motivos). Valem para o bot e para a página de pedido.
-- Rode uma vez no SQL Editor do Supabase.
create table if not exists motivos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 10,
  ativo boolean not null default true);
create unique index if not exists motivos_nome on motivos (fn_sem_acento(nome));

insert into motivos (nome, ordem) values ('Visita a cliente', 1), ('Viagem / aeroporto', 2), ('Hora extra', 3)
on conflict do nothing;

alter table motivos enable row level security;
drop policy if exists motivos_ler on motivos;
create policy motivos_ler on motivos for select using (is_usuario());
drop policy if exists motivos_admin on motivos;
create policy motivos_admin on motivos for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on motivos to authenticated;
grant all on motivos to service_role;
