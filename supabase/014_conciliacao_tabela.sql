-- 014: a conciliação também confere a fatura com a tabela de preços (bid).
-- Item cobrado acima do valor de tabela da corrida (mais a tolerância tolerancia_tabela_valor) fica
-- "Acima da tabela", mesmo que o fornecedor tenha informado esse valor na corrida.
-- Rode uma vez no SQL Editor do Supabase, depois de 008_tabela_precos.sql.
begin;

insert into parametros (chave, valor, descricao) values
  ('tolerancia_tabela_valor', '0', 'Na conciliação, quanto (em reais) a cobrança pode passar do valor da tabela de preços sem ser apontada como "Acima da tabela"')
on conflict (chave) do nothing;

alter table fatura_itens drop constraint if exists fatura_itens_situacao_check;
alter table fatura_itens add constraint fatura_itens_situacao_check
  check (situacao in ('conciliado','divergente','sem_valor','sem_protocolo','cancelada','duplicado','outro_fornecedor','acima_tabela'));

-- Cruza cada item da fatura com as corridas pelo protocolo e classifica a situação. Pode ser rodada de novo.
-- Ordem: sem protocolo, outro fornecedor, duplicado, cancelada, acima da tabela, sem valor, divergente, conciliado.
-- O valor de tabela só vale quando foi calculado para o fornecedor da fatura.
create or replace function fn_conciliar_fatura(p_fatura uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fat faturas; r record; v_c corridas; v_sit text; v_pct numeric; v_abs numeric; v_tol numeric; v_tol_tab numeric; v_tab numeric;
begin
  if auth.uid() is not null and not is_planejamento() then raise exception 'Sem permissão para conciliar faturas'; end if;
  v_fat := (select f from faturas f where f.id = p_fatura);
  if v_fat.id is null then raise exception 'Fatura não encontrada'; end if;
  v_pct := fn_param_num('tolerancia_pct', 5);
  v_abs := fn_param_num('tolerancia_valor', 5);
  v_tol_tab := greatest(fn_param_num('tolerancia_tabela_valor', 0), 0);

  for r in select * from fatura_itens where fatura_id = p_fatura order by data_corrida nulls last, id loop
    v_c := null;
    if coalesce(btrim(r.protocolo_informado), '') <> '' then
      v_c := (select c from corridas c where c.protocolo = upper(btrim(r.protocolo_informado)));
    end if;
    v_tab := case when v_c.valor_tabela is not null and v_c.preco_fornecedor_id = v_fat.fornecedor_id then v_c.valor_tabela end;

    if v_c.id is null then v_sit := 'sem_protocolo';
    elsif v_c.fornecedor_id is distinct from v_fat.fornecedor_id then v_sit := 'outro_fornecedor';
    elsif exists (select 1 from fatura_itens o where o.corrida_id = v_c.id and o.id <> r.id
                  and (o.fatura_id <> p_fatura or o.id < r.id)) then v_sit := 'duplicado';
    elsif v_c.status = 'cancelada' then v_sit := 'cancelada';
    elsif v_tab is not null and r.valor > v_tab + v_tol_tab + 0.005 then v_sit := 'acima_tabela';
    elsif v_c.valor_informado is null then
      -- Sem valor informado, mas dentro da tabela: a tabela basta
      v_sit := case when v_tab is not null then 'conciliado' else 'sem_valor' end;
    else
      v_tol := greatest(v_abs, v_c.valor_informado * v_pct / 100);
      v_sit := case when abs(r.valor - v_c.valor_informado) <= v_tol then 'conciliado' else 'divergente' end;
    end if;

    update fatura_itens set corrida_id = v_c.id, situacao = v_sit where id = r.id;
    if v_c.id is not null and v_sit not in ('duplicado','outro_fornecedor') then
      update corridas set valor_faturado = r.valor where id = v_c.id;
    end if;
  end loop;

  update faturas set status = 'em_conciliacao',
    valor_total = (select coalesce(sum(valor), 0) from fatura_itens where fatura_id = p_fatura)
  where id = p_fatura;

  return (select jsonb_object_agg(situacao, n) from (
    select situacao, count(*) n from fatura_itens where fatura_id = p_fatura group by situacao) s);
end $$;

commit;
