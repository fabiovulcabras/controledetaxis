-- 023: cadastro de colaboradores da Importação de Ativos (Cadastros › Importação de Ativos).
-- O RH envia a planilha de ativos; o painel cadastra os novos e, para quem não veio na planilha, pede a
-- confirmação do desligamento. Ao confirmar, o colaborador fica inativo e a pessoa autorizada com a mesma
-- matrícula (solicitantes.matricula) deixa de poder pedir táxi. Rode uma vez no SQL Editor do Supabase.
create table if not exists colaboradores (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nome text not null,
  cargo text,
  setor text,
  admissao date,
  situacao text,
  ativo boolean not null default true,
  desligado_em timestamptz,
  criado_em timestamptz not null default now());
create unique index if not exists colaboradores_codigo on colaboradores (codigo);

alter table colaboradores enable row level security;
drop policy if exists colaboradores_ler on colaboradores;
create policy colaboradores_ler on colaboradores for select using (is_usuario());
drop policy if exists colaboradores_admin on colaboradores;
create policy colaboradores_admin on colaboradores for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on colaboradores to authenticated;
grant all on colaboradores to service_role;
