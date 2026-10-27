-- 008: tabela de preços combinados com cada fornecedor.
-- Fora de Extrema o preço vale por cidade; dentro de Extrema, por bairro (linha sem bairro = resto da cidade).
-- Veículo e modalidade saem dos passageiros: 1 = Passeio/destino único; 2 a 4 = Passeio/diversos destinos;
-- 5 e 6 = Spin; 7 ou mais = Van. O fornecedor lança o valor e o sistema compara com a tabela.
-- Rode uma vez no SQL Editor do Supabase, depois de 007_palavra_ativacao.sql.

create table if not exists precos_tabela (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references fornecedores on delete cascade,
  localidade text not null,                 -- como aparece na tabela do fornecedor (ex.: "Toledo - Pereiras")
  cidade text not null,
  uf text,
  bairro text,                              -- vazio = a cidade toda (ou o resto dela)
  apelidos text,                            -- outros nomes do bairro/região, separados por vírgula
  modalidade text not null default 'qualquer' check (modalidade in ('unico', 'diversos', 'qualquer')),
  veiculo text not null check (veiculo in ('passeio', 'spin', 'van')),
  valor numeric(10, 2) not null check (valor > 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now());
create unique index if not exists precos_tabela_unico
  on precos_tabela (fornecedor_id, fn_sem_acento(cidade), fn_sem_acento(coalesce(bairro, '')), modalidade, veiculo);

-- Valor de tabela calculado para a corrida (quando o fornecedor recebe ou lança o valor)
alter table corridas add column if not exists valor_tabela numeric(10, 2);
alter table corridas add column if not exists preco_id uuid references precos_tabela on delete set null;
alter table corridas add column if not exists preco_descricao text;
alter table corridas add column if not exists preco_fornecedor_id uuid;
alter table corridas add column if not exists preco_calculado_em timestamptz;

-- A lista do painel passa a trazer as colunas novas
drop view if exists corridas_lista;
create view corridas_lista with (security_invoker = true) as
select c.*,
  s.nome as solicitante_nome, s.setor as solicitante_setor, s.telefone_whatsapp as solicitante_telefone,
  f.nome as fornecedor_nome, f.telefone_whatsapp as fornecedor_telefone,
  cc.codigo as centro_codigo, cc.descricao as centro_descricao,
  fn_sem_acento(concat_ws(' ', c.protocolo, s.nome, s.setor, c.origem, c.destino, c.motivo, f.nome)) as busca
from corridas c
join solicitantes s on s.id = c.solicitante_id
left join fornecedores f on f.id = c.fornecedor_id
left join centros_custo cc on cc.id = c.centro_custo_id;
grant select on corridas_lista to authenticated, service_role;

alter table precos_tabela enable row level security;
drop policy if exists precos_tabela_ler on precos_tabela;
create policy precos_tabela_ler on precos_tabela for select using (is_usuario());
drop policy if exists precos_tabela_admin on precos_tabela;
create policy precos_tabela_admin on precos_tabela for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on precos_tabela to authenticated;
grant all on precos_tabela to service_role;

-- Tabela de Preços 2026 do Reinaldo (coluna "Novo Valor Total"). Onde a planilha só tem a coluna "Valor"
-- (Atibaia, Guarulhos, Jundiaí, São Paulo e São José dos Campos), ela entra como Passeio.
create or replace function fn_carregar_tabela_reinaldo_2026(p_fornecedor uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into precos_tabela (fornecedor_id, localidade, cidade, uf, bairro, apelidos, modalidade, veiculo, valor)
  select p_fornecedor, t.* from (values
    ('Atibaia - SP','Atibaia','SP',null,null,'unico','passeio',299.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'unico','passeio',164.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'unico','spin',211.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'unico','van',384.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'diversos','passeio',211.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'diversos','spin',258.0),
    ('Bragança Paulista - SP','Bragança Paulista','SP',null,null,'diversos','van',494.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','unico','passeio',129.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','unico','spin',176.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','unico','van',302.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','diversos','passeio',164.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','diversos','spin',211.0),
    ('Extrema - Mantiqueira','Extrema','MG','Mantiqueira','atras da bauducco','diversos','van',384.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'unico','passeio',129.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'unico','spin',176.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'unico','van',302.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'diversos','passeio',164.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'diversos','spin',211.0),
    ('Extrema - Pessegueiro','Extrema','MG','Pessegueiro',null,'diversos','van',384.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'unico','passeio',129.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'unico','spin',176.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'unico','van',302.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'diversos','passeio',164.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'diversos','spin',211.0),
    ('Extrema - Roseira','Extrema','MG','Roseira',null,'diversos','van',384.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'unico','passeio',129.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'unico','spin',176.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'unico','van',302.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'diversos','passeio',164.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'diversos','spin',211.0),
    ('Extrema - Salto do meio','Extrema','MG','Salto do Meio',null,'diversos','van',384.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'unico','passeio',82.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'unico','spin',129.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'unico','van',192.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'diversos','passeio',106.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'diversos','spin',153.0),
    ('Extrema (Central) - MG','Extrema','MG',null,null,'diversos','van',249.0),
    ('Guarulhos - Aeroporto','Guarulhos','SP',null,'aeroporto,cumbica','unico','passeio',410.0),
    ('Jundiaí - SP','Jundiaí','SP',null,null,'unico','passeio',400.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'unico','passeio',252.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'unico','spin',299.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'unico','van',525.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'diversos','passeio',322.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'diversos','spin',369.0),
    ('Munhoz - MG','Munhoz','MG',null,null,'diversos','van',584.0),
    ('São Paulo - Capital','São Paulo','SP',null,null,'unico','passeio',465.0),
    ('São José dos Campos - SP','São José dos Campos','SP',null,null,'unico','passeio',520.0),
    ('Toledo - MG','Toledo','MG',null,null,'unico','passeio',158.0),
    ('Toledo - MG','Toledo','MG',null,null,'unico','spin',205.0),
    ('Toledo - MG','Toledo','MG',null,null,'unico','van',463.0),
    ('Toledo - MG','Toledo','MG',null,null,'diversos','passeio',205.0),
    ('Toledo - MG','Toledo','MG',null,null,'diversos','spin',252.0),
    ('Toledo - MG','Toledo','MG',null,null,'diversos','van',528.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'unico','passeio',234.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'unico','spin',281.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'unico','van',504.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'diversos','passeio',300.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'diversos','spin',347.0),
    ('Toledo - Pereiras','Toledo','MG','Pereiras',null,'diversos','van',587.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','unico','passeio',158.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','unico','spin',205.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','unico','van',296.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','diversos','passeio',202.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','diversos','spin',249.0),
    ('Vargem - Guaraiuva','Vargem','SP','Guaraiuva','guaraiúva','diversos','van',379.0),
    ('Vargem - SP','Vargem','SP',null,null,'unico','passeio',94.0),
    ('Vargem - SP','Vargem','SP',null,null,'unico','spin',141.0),
    ('Vargem - SP','Vargem','SP',null,null,'unico','van',231.0),
    ('Vargem - SP','Vargem','SP',null,null,'diversos','passeio',123.0),
    ('Vargem - SP','Vargem','SP',null,null,'diversos','spin',170.0),
    ('Vargem - SP','Vargem','SP',null,null,'diversos','van',303.0)
  ) as t(localidade, cidade, uf, bairro, apelidos, modalidade, veiculo, valor)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function fn_carregar_tabela_reinaldo_2026(uuid) from public;
grant execute on function fn_carregar_tabela_reinaldo_2026(uuid) to service_role;

-- Carrega para o fornecedor cadastrado com "Reinaldo" no nome (se houver).
-- Com outro nome, rode: select fn_carregar_tabela_reinaldo_2026(id) from fornecedores where nome = 'NOME EXATO';
select fn_carregar_tabela_reinaldo_2026(id) from fornecedores where fn_sem_acento(nome) like '%reinaldo%';
