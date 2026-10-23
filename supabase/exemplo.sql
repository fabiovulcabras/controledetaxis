-- Dados de exemplo para testar o painel e o Simulador. Opcional: rode depois do schema.sql.
-- Os telefones são fictícios (55119000000xx) e servem só para o modo simulado.
insert into unidades (id, nome, endereco_padrao) values
  ('a1000000-0000-0000-0000-000000000001', 'Unidade Centro', 'R. das Indústrias, 450 - Centro');

insert into centros_custo (id, codigo, descricao, unidade_id, teto_por_corrida) values
  ('c1000000-0000-0000-0000-000000000001', 'CC 4100', 'Logística',      'a1000000-0000-0000-0000-000000000001', 150),
  ('c1000000-0000-0000-0000-000000000002', 'CC 2300', 'Comercial',      'a1000000-0000-0000-0000-000000000001', 250),
  ('c1000000-0000-0000-0000-000000000003', 'CC 3100', 'Produção',       'a1000000-0000-0000-0000-000000000001', 120),
  ('c1000000-0000-0000-0000-000000000004', 'CC 5000', 'Administrativo', 'a1000000-0000-0000-0000-000000000001', null);

insert into fornecedores (id, nome, cnpj, telefone_whatsapp, prioridade, prazo_resposta_min) values
  ('f1000000-0000-0000-0000-000000000001', 'Rádio Táxi Central', '11222333000181', '5511900000101', 1, 10),
  ('f1000000-0000-0000-0000-000000000002', 'Coop Táxi Express',  '44555666000172', '5511900000102', 2, 10);

insert into solicitantes (nome, matricula, setor, telefone_whatsapp, unidade_id, centro_custo_padrao_id, fornecedor_padrao_id) values
  ('Ana Ribeiro',  '10234', 'Logística', '5511900000001', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  ('Marcos Lima',  '10571', 'Comercial', '5511900000002', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002'),
  ('João Pereira', '10890', 'Produção',  '5511900000003', 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', null);

update parametros set valor = '5511900000900' where chave = 'planejamento_telefones';
