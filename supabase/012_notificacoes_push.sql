-- 012: notificações push (celular e computador) para solicitantes, fornecedores e planejamento.
-- Cada aparelho que ativa as notificações vira uma inscrição. Só o servidor (service_role) lê e grava.
-- Rode uma vez no SQL Editor do Supabase.
create table if not exists push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tipo text not null check (tipo in ('solicitante', 'fornecedor', 'planejamento')),
  solicitante_id uuid references solicitantes on delete cascade,
  fornecedor_id uuid references fornecedores on delete cascade,
  usuario_id uuid,
  aparelho text,
  criado_em timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  falhas int not null default 0,
  check ((tipo = 'solicitante' and solicitante_id is not null)
      or (tipo = 'fornecedor' and fornecedor_id is not null)
      or (tipo = 'planejamento' and usuario_id is not null)));
create index if not exists push_inscricoes_solicitante on push_inscricoes (solicitante_id) where solicitante_id is not null;
create index if not exists push_inscricoes_fornecedor on push_inscricoes (fornecedor_id) where fornecedor_id is not null;
create index if not exists push_inscricoes_planejamento on push_inscricoes (tipo) where tipo = 'planejamento';

alter table push_inscricoes enable row level security;
grant all on push_inscricoes to service_role;
