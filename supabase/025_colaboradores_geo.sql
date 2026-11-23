-- 025: coordenadas da casa dos colaboradores, para a roteirização de Extras não buscar 400 endereços no mapa a cada uso.
-- Ficam guardadas por até 30 dias (geo_em); endereço novo na Importação de Ativos apaga as coordenadas antigas.
-- Rode uma vez no SQL Editor do Supabase (depois da 024).
alter table colaboradores add column if not exists lat double precision;
alter table colaboradores add column if not exists lng double precision;
alter table colaboradores add column if not exists geo_precisao text check (geo_precisao is null or geo_precisao in ('endereco','bairro','cidade','nenhuma'));
alter table colaboradores add column if not exists geo_em timestamptz;

create or replace function fn_colaboradores_limpar_coordenadas() returns trigger language plpgsql as $$
begin
  if (new.endereco is distinct from old.endereco or new.bairro is distinct from old.bairro
      or new.cidade is distinct from old.cidade or new.cep is distinct from old.cep)
     and new.lat is not distinct from old.lat and new.geo_em is not distinct from old.geo_em then
    new.lat := null; new.lng := null; new.geo_precisao := null; new.geo_em := null;
  end if;
  return new;
end $$;
drop trigger if exists colaboradores_coordenadas on colaboradores;
create trigger colaboradores_coordenadas before update on colaboradores for each row execute function fn_colaboradores_limpar_coordenadas();
