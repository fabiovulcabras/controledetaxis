-- 006: fila de fornecedores com prazo controlado pelo Upstash QStash e envio pela Evolution API.
-- Rode uma vez no SQL Editor do Supabase, depois de 005_locais.sql.
--
-- corrida_tentativas é a fila de cada corrida: cada envio a um fornecedor vira uma linha, na ordem (1º, 2º, 3º…),
-- com o prazo e o resultado (aceita, recusada, expirada…). Ela é mantida por gatilho a partir do status da corrida,
-- então qualquer caminho (bot, link, painel, QStash, agendador) registra igual. Só pode haver uma tentativa pendente por corrida.

create table if not exists corrida_tentativas (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references corridas on delete cascade,
  fornecedor_id uuid not null references fornecedores,
  ordem int not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'aceita_fora_do_prazo', 'recusada', 'expirada', 'cancelada', 'substituida')),
  enviada_em timestamptz not null default now(),
  prazo_em timestamptz,
  encerrada_em timestamptz,
  qstash_message_id text,            -- tarefa agendada no QStash para o fim do prazo
  qstash_agendado_em timestamptz,
  unique (corrida_id, ordem));
create unique index if not exists corrida_tentativas_uma_pendente on corrida_tentativas (corrida_id) where status = 'pendente';
create index if not exists corrida_tentativas_agendar on corrida_tentativas (status) where qstash_message_id is null;

create or replace function fn_registrar_tentativa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Corrida enviada a um fornecedor (nova, ou passada a outro): fecha a pendente anterior e abre a próxima da fila
  if new.status = 'enviada' and new.fornecedor_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'enviada' or old.fornecedor_id is distinct from new.fornecedor_id) then
    update corrida_tentativas set status = 'substituida', encerrada_em = now() where corrida_id = new.id and status = 'pendente';
    insert into corrida_tentativas (corrida_id, fornecedor_id, ordem, prazo_em)
    values (new.id, new.fornecedor_id, coalesce((select max(ordem) from corrida_tentativas where corrida_id = new.id), 0) + 1, new.prazo_resposta_em);
    return new;
  end if;
  if tg_op <> 'UPDATE' then return new; end if;

  -- Mesmo fornecedor, prazo novo: reagenda
  if new.status = 'enviada' and new.prazo_resposta_em is distinct from old.prazo_resposta_em then
    update corrida_tentativas set prazo_em = new.prazo_resposta_em, qstash_message_id = null, qstash_agendado_em = null
    where corrida_id = new.id and status = 'pendente';
  end if;

  if new.status is distinct from old.status and new.status in ('aceita', 'recusada', 'sem_resposta', 'cancelada') then
    update corrida_tentativas set encerrada_em = now(), status = case new.status
      when 'aceita' then 'aceita' when 'recusada' then 'recusada' when 'sem_resposta' then 'expirada' else 'cancelada' end
    where corrida_id = new.id and status = 'pendente';
    -- Aceite depois de vencido o prazo: marca a tentativa expirada daquele fornecedor
    if new.status = 'aceita' and old.status = 'sem_resposta' then
      update corrida_tentativas set status = 'aceita_fora_do_prazo', encerrada_em = now()
      where id = (select id from corrida_tentativas where corrida_id = new.id and fornecedor_id = new.fornecedor_id order by ordem desc limit 1);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists corridas_tentativas on corridas;
create trigger corridas_tentativas after insert or update of status, fornecedor_id, prazo_resposta_em on corridas
  for each row execute function fn_registrar_tentativa();

-- Corridas que já estavam aguardando resposta entram na fila
insert into corrida_tentativas (corrida_id, fornecedor_id, ordem, prazo_em)
select c.id, c.fornecedor_id, 1, c.prazo_resposta_em from corridas c
where c.status = 'enviada' and c.fornecedor_id is not null
  and not exists (select 1 from corrida_tentativas t where t.corrida_id = c.id);

-- Última lista de opções enviada a cada número. Na Evolution API não há botões: as opções vão numeradas
-- ("1 - Aceitar") e a resposta "1" é traduzida para a opção correspondente.
create table if not exists opcoes_enviadas (
  telefone text primary key,
  opcoes jsonb,
  enviado_em timestamptz not null default now());

-- Mensagens enviadas e recebidas pela Evolution API
alter table mensagens drop constraint if exists mensagens_canal_check;
alter table mensagens add constraint mensagens_canal_check check (canal in ('whatsapp', 'simulado', 'evolution'));

alter table corrida_tentativas enable row level security;
drop policy if exists corrida_tentativas_ler on corrida_tentativas;
create policy corrida_tentativas_ler on corrida_tentativas for select using (is_usuario());
grant select on corrida_tentativas to authenticated;
grant all on corrida_tentativas to service_role;
alter table opcoes_enviadas enable row level security; -- só o servidor (service_role) usa
grant all on opcoes_enviadas to service_role;
