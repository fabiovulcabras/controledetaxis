-- Zera as coordenadas guardadas: a localização agora é validada contra a cidade do cadastro (raio de 30 km)
-- e as casas já guardadas podem estar no lugar errado. Serão buscadas de novo na próxima extra.
update public.colaboradores set lat = null, lng = null, geo_precisao = null, geo_em = null
where lat is not null or lng is not null;
