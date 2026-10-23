-- ============ 002 — Pedido e resposta por links do WhatsApp (wa.me) ============
-- Rode no SQL Editor depois do schema.sql. Pode rodar mais de uma vez.
-- Cada pessoa autorizada recebe um link pessoal de pedido; cada corrida, um link para o fornecedor responder.
-- O token é a "senha" do link: 64 caracteres aleatórios, trocados quando o link precisa ser revogado.

create or replace function fn_novo_token() returns text language sql volatile as
$$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

alter table solicitantes add column if not exists token_pedido text default fn_novo_token();
update solicitantes set token_pedido = fn_novo_token() where token_pedido is null;
alter table solicitantes alter column token_pedido set not null;
create unique index if not exists solicitantes_token_pedido on solicitantes (token_pedido);

alter table corridas add column if not exists token_fornecedor text default fn_novo_token();
update corridas set token_fornecedor = fn_novo_token() where token_fornecedor is null;
alter table corridas alter column token_fornecedor set not null;
create unique index if not exists corridas_token_fornecedor on corridas (token_fornecedor);

-- fn_mudar_status passa a aceitar token_fornecedor (trocado quando a corrida vai para outro fornecedor)
create or replace function fn_mudar_status(p_corrida uuid, p_status status_corrida, p_origem origem_evento,
  p_obs text default null, p_campos jsonb default '{}'::jsonb)
returns corridas language plpgsql security definer set search_path = public as $$
declare v_atual corridas; v_nova corridas; v_uid uuid := auth.uid();
begin
  if v_uid is not null and not is_planejamento() then raise exception 'Sem permissão para alterar corridas'; end if;
  v_atual := (select c from corridas c where c.id = p_corrida for update);
  if v_atual.id is null then raise exception 'Corrida não encontrada'; end if;
  if p_status is not null and not fn_transicao_valida(v_atual.status, p_status) then
    raise exception 'Mudança de status não permitida: % → %', v_atual.status, p_status;
  end if;
  if p_status = 'contestada' and v_atual.status = 'validada' and coalesce(btrim(p_obs), '') = '' then
    raise exception 'Informe a justificativa para reabrir uma corrida validada';
  end if;
  p_campos := coalesce(p_campos, '{}'::jsonb);

  update corridas set
    status = coalesce(p_status, status),
    fornecedor_id = case when p_campos ? 'fornecedor_id' then (p_campos->>'fornecedor_id')::uuid else fornecedor_id end,
    motorista = case when p_campos ? 'motorista' then p_campos->>'motorista' else motorista end,
    veiculo_placa = case when p_campos ? 'veiculo_placa' then p_campos->>'veiculo_placa' else veiculo_placa end,
    eta_minutos = case when p_campos ? 'eta_minutos' then (p_campos->>'eta_minutos')::int else eta_minutos end,
    valor_informado = case when p_campos ? 'valor_informado' then (p_campos->>'valor_informado')::numeric else valor_informado end,
    prazo_resposta_em = case when p_campos ? 'prazo_resposta_em' then (p_campos->>'prazo_resposta_em')::timestamptz else prazo_resposta_em end,
    motivo_recusa = case when p_campos ? 'motivo_recusa' then p_campos->>'motivo_recusa' else motivo_recusa end,
    motivo_cancelamento = case when p_campos ? 'motivo_cancelamento' then p_campos->>'motivo_cancelamento' else motivo_cancelamento end,
    token_fornecedor = case when p_campos ? 'token_fornecedor' then p_campos->>'token_fornecedor' else token_fornecedor end,
    lembrete_enviado_em = case when p_campos ? 'lembrete_enviado_em' then (p_campos->>'lembrete_enviado_em')::timestamptz else lembrete_enviado_em end,
    validado_por = case when p_status = 'validada' then v_uid when p_status = 'contestada' then null else validado_por end,
    validado_em = case when p_status = 'validada' then now() when p_status = 'contestada' then null else validado_em end
  where id = p_corrida
  returning * into v_nova;

  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao)
  values (p_corrida, v_atual.status, v_nova.status, p_origem, v_uid, p_obs);
  return v_nova;
end $$;
