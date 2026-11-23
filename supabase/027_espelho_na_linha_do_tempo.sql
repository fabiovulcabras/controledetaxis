-- 027: etapas do fechamento (espelho gerado, validado pelo fornecedor, NF enviada, pagamento...) na linha do tempo de cada corrida.
-- Cada etapa vira um evento em corrida_eventos (sem mudar o status da corrida) com um título próprio (coluna etapa).
-- No fim, preenche o histórico das corridas que já estão em espelhos.
-- Rode uma vez no SQL Editor do Supabase, depois de 026.
begin;

alter table corrida_eventos add column if not exists etapa text;

-- Título da etapa para cada tipo de evento do espelho
create or replace function fn_etapa_espelho(p_tipo text, p_descricao text) returns text language sql immutable as $$
  select case p_tipo
    when 'gerado' then 'Espelho gerado'
    when 'reemitido' then 'Espelho reenviado ao fornecedor'
    when 'aprovado' then case when p_descricao ilike 'Aprovado automaticamente%' then 'Espelho aprovado automaticamente' else 'Espelho validado pelo fornecedor' end
    when 'nf' then 'NF enviada pelo fornecedor'
    when 'pago' then 'Pagamento realizado'
    when 'contestacao' then 'Fornecedor contestou o valor'
    when 'decisao' then 'Contestação decidida'
    when 'ajuste' then 'Valor ajustado no espelho'
  end
$$;

-- Passa a gravar também na linha do tempo das corridas do espelho (todas, ou só a do item quando o evento é de um item)
drop function if exists fn_espelho_evento(uuid, text, text, text);
create or replace function fn_espelho_evento(p_espelho uuid, p_origem text, p_tipo text, p_descricao text, p_corrida uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_comp text; v_etapa text := fn_etapa_espelho(p_tipo, p_descricao);
begin
  insert into espelho_eventos (espelho_id, origem, tipo, descricao, usuario_id) values (p_espelho, p_origem, p_tipo, p_descricao, auth.uid());
  if v_etapa is null then return; end if;
  v_comp := (select substr(competencia, 6, 2) || '/' || substr(competencia, 1, 4) from espelhos where id = p_espelho);
  insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao, fornecedor_id, etapa)
  select c.id, c.status, c.status, p_origem::origem_evento, auth.uid(),
    format('Espelho %s · %s', v_comp, p_descricao) ||
      case when p_tipo in ('gerado','reemitido','aprovado') then format(' · valor desta corrida %s', fn_brl(i.valor_final)) else '' end,
    c.fornecedor_id, v_etapa
  from espelho_itens i join corridas c on c.id = i.corrida_id
  where i.espelho_id = p_espelho and (p_corrida is null or i.corrida_id = p_corrida);
end $$;

-- Eventos de um item só: informam a corrida (a ordem dos parâmetros das chamadas antigas não muda)
create or replace function fn_ajustar_item_espelho(p_item uuid, p_valor numeric, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare v espelho_itens; v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para ajustar espelhos'; end if;
  v := (select i from espelho_itens i where i.id = p_item for update);
  if v.id is null then raise exception 'Item não encontrado'; end if;
  v_esp := (select e from espelhos e where e.id = v.espelho_id);
  if v_esp.status not in ('aguardando','contestado') then raise exception 'O espelho já foi aprovado; não dá mais para ajustar'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Valor inválido'; end if;
  if p_valor <> v.valor_base and coalesce(btrim(p_obs), '') = '' then raise exception 'Informe o motivo do ajuste'; end if;
  update espelho_itens set valor_base = p_valor, conferir = false, ajuste_obs = coalesce(nullif(btrim(p_obs), ''), ajuste_obs) where id = p_item;
  perform fn_espelho_recalcular(v.espelho_id);
  perform fn_espelho_evento(v.espelho_id, 'planejamento', 'ajuste',
    format('%s: %s → %s%s', (select protocolo from corridas where id = v.corrida_id), fn_brl(v.valor_base), fn_brl(p_valor),
      coalesce(' (' || nullif(btrim(p_obs), '') || ')', '')), v.corrida_id);
end $$;

create or replace function fn_contestar_espelho(p_espelho uuid, p_itens jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_esp espelhos; r jsonb; v espelho_itens; v_n int := 0;
begin
  if auth.uid() is not null then raise exception 'Só o fornecedor contesta, pelo portal'; end if;
  v_esp := (select e from espelhos e where e.id = p_espelho for update);
  if v_esp.id is null then raise exception 'Espelho não encontrado'; end if;
  if v_esp.status <> 'aguardando' then raise exception 'Este espelho não está aguardando conferência'; end if;
  if now() > v_esp.prazo_em then raise exception 'O prazo para conferir este espelho terminou'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v := (select i from espelho_itens i where i.id = (r->>'id')::uuid and i.espelho_id = p_espelho for update);
    if v.id is null then raise exception 'Item não encontrado no espelho'; end if;
    if coalesce(btrim(r->>'motivo'), '') = '' then raise exception 'Informe o motivo de cada item contestado'; end if;
    if (r->>'valor') is null or (r->>'valor')::numeric < 0 then raise exception 'Informe o valor que você entende correto'; end if;
    update espelho_itens set contestacao_status = 'contestado', contestacao_motivo = left(btrim(r->>'motivo'), 500),
      contestacao_valor = round((r->>'valor')::numeric, 2), contestacao_resposta = null, contestado_em = now(),
      decidido_por = null, decidido_em = null
    where id = v.id;
    perform fn_espelho_evento(p_espelho, 'fornecedor', 'contestacao',
      format('%s: pede %s (espelho %s). Motivo: %s', (select protocolo from corridas where id = v.corrida_id),
        fn_brl((r->>'valor')::numeric), fn_brl(v.valor_final), btrim(r->>'motivo')), v.corrida_id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Escolha ao menos um item para contestar'; end if;
  update espelhos set status = 'contestado' where id = p_espelho;
end $$;

create or replace function fn_decidir_contestacao(p_item uuid, p_decisao text, p_resposta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v espelho_itens; v_esp espelhos;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para decidir contestações'; end if;
  v := (select i from espelho_itens i where i.id = p_item for update);
  if v.id is null then raise exception 'Item não encontrado'; end if;
  v_esp := (select e from espelhos e where e.id = v.espelho_id);
  if v_esp.status <> 'contestado' or v.contestacao_status <> 'contestado' then raise exception 'Este item não está contestado'; end if;
  if p_decisao not in ('aceita','mantida') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'mantida' and coalesce(btrim(p_resposta), '') = '' then raise exception 'Explique ao fornecedor por que o valor foi mantido'; end if;
  update espelho_itens set contestacao_status = p_decisao, contestacao_resposta = nullif(btrim(p_resposta), ''),
    decidido_por = auth.uid(), decidido_em = now() where id = p_item;
  perform fn_espelho_recalcular(v.espelho_id);
  perform fn_espelho_evento(v.espelho_id, 'planejamento', 'decisao',
    format('%s: contestação %s%s', (select protocolo from corridas where id = v.corrida_id),
      case when p_decisao = 'aceita' then 'aceita, valor ' || fn_brl(v.contestacao_valor) else 'recusada, valor mantido' end,
      coalesce(' (' || nullif(btrim(p_resposta), '') || ')', '')), v.corrida_id);
end $$;

revoke execute on function fn_espelho_evento(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function fn_espelho_evento(uuid, text, text, text, uuid) to service_role;

-- ---------- Histórico das corridas que já estão em espelhos ----------
-- Uma vez só: não repete etapa já gravada (mesma corrida, mesma etapa, mesmo instante).
insert into corrida_eventos (corrida_id, status_anterior, status_novo, origem, usuario_id, observacao, fornecedor_id, etapa, criado_em)
select c.id, st.status, st.status, ev.origem::origem_evento, ev.usuario_id,
  format('Espelho %s · %s', substr(e.competencia, 6, 2) || '/' || substr(e.competencia, 1, 4), ev.descricao) ||
    case when ev.tipo in ('gerado','reemitido','aprovado') then format(' · valor desta corrida %s', fn_brl(i.valor_final)) else '' end,
  c.fornecedor_id, fn_etapa_espelho(ev.tipo, ev.descricao), ev.criado_em
from espelho_eventos ev
join espelhos e on e.id = ev.espelho_id
join espelho_itens i on i.espelho_id = e.id
join corridas c on c.id = i.corrida_id
cross join lateral (
  select coalesce((select x.status_novo from corrida_eventos x where x.corrida_id = c.id and x.criado_em <= ev.criado_em and x.etapa is null
                   order by x.criado_em desc limit 1), c.status) as status
) st
where fn_etapa_espelho(ev.tipo, ev.descricao) is not null
  and (ev.tipo in ('gerado','reemitido','aprovado','nf','pago') or ev.descricao like c.protocolo || ':%')
  and not exists (select 1 from corrida_eventos x where x.corrida_id = c.id and x.etapa = fn_etapa_espelho(ev.tipo, ev.descricao) and x.criado_em = ev.criado_em);

commit;
