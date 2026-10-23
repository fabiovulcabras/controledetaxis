-- Agendador gratuito pelo próprio Supabase: chama /api/cron/prazos a cada 2 minutos.
-- 1. Em Database > Extensions, ative pg_cron e pg_net.
-- 2. Troque o endereço e o segredo abaixo (o mesmo valor de CRON_SECRET na Vercel) e rode no SQL Editor.
select cron.schedule(
  'taxis-prazos',
  '*/2 * * * *',
  $$ select net.http_get(
       url := 'https://SEU-APP.vercel.app/api/cron/prazos',
       headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET')
     ) $$
);
-- Para remover: select cron.unschedule('taxis-prazos');
