-- 024: endereço dos colaboradores (Importação de Ativos) para a roteirização de Extras.
-- Endereço, nascimento e CEP são dados pessoais: com esta migração só admin e planejamento leem a tabela.
-- Rode uma vez no SQL Editor do Supabase (depois da 023).
alter table colaboradores add column if not exists endereco text;
alter table colaboradores add column if not exists bairro text;
alter table colaboradores add column if not exists cidade text;
alter table colaboradores add column if not exists uf text check (uf is null or uf ~ '^[A-Z]{2}$');
alter table colaboradores add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$');
alter table colaboradores add column if not exists nascimento date;

drop policy if exists colaboradores_ler on colaboradores;
create policy colaboradores_ler on colaboradores for select using (is_planejamento());
