-- 007: palavra de ativação do bot.
-- Preenchido (ex.: "taxi"), o bot só responde a mensagens com a palavra, a conversas já em andamento
-- e a fornecedores respondendo corridas. Vazio = bot responde a tudo (como antes).
-- Rode uma vez no SQL Editor do Supabase.
insert into parametros (chave, valor, descricao) values
  ('palavra_ativacao', '', 'Palavra que liga o bot (ex.: taxi). Várias separadas por vírgula; sem diferença de acento ou maiúscula. Vazio = o bot responde a todas as mensagens')
on conflict (chave) do nothing;
