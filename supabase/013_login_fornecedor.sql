-- 013: login no portal do fornecedor.
-- O portal (/fornecedor/…) passa a pedir e-mail e senha. A senha é o código de acesso de 6 dígitos
-- (tela Portais dos fornecedores); gerar novo código desconecta os aparelhos já conectados.
-- Rode uma vez no SQL Editor do Supabase e cadastre o e-mail de cada fornecedor em Cadastros > Fornecedores.
begin;

alter table fornecedores add column if not exists email text;
update fornecedores set email = nullif(lower(btrim(email)), '') where email is not null;

alter table fornecedores drop constraint if exists fornecedores_email_valido;
alter table fornecedores add constraint fornecedores_email_valido
  check (email is null or (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

create unique index if not exists fornecedores_email_unico on fornecedores (email) where email is not null;

-- Grava o e-mail sempre em minúsculas e sem espaços, venha de onde vier (tela de cadastro ou importação).
create or replace function fn_fornecedor_email() returns trigger language plpgsql as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  return new;
end $$;
drop trigger if exists tg_fornecedor_email on fornecedores;
create trigger tg_fornecedor_email before insert or update of email on fornecedores
  for each row execute function fn_fornecedor_email();

comment on column fornecedores.email is 'E-mail de login do portal do fornecedor (a senha é o código de acesso).';

commit;
