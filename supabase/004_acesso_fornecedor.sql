-- 004: só o fornecedor responde a corrida.
-- O link /f/… continua mostrando a corrida, mas aceitar, recusar, cancelar e informar valor
-- exigem que o aparelho esteja identificado como do fornecedor (portal ou código de acesso).
-- Rode uma vez no SQL Editor do Supabase, depois de 003_melhorias.sql.

alter table fornecedores add column if not exists codigo_acesso text
  default lpad((floor(random() * 1000000))::int::text, 6, '0');
update fornecedores set codigo_acesso = lpad((floor(random() * 1000000))::int::text, 6, '0') where codigo_acesso is null;
alter table fornecedores alter column codigo_acesso set not null;

comment on column fornecedores.codigo_acesso is
  'Código de 6 dígitos que o fornecedor digita na página da corrida para liberar as ações neste aparelho. Enviado só pelo planejamento.';
