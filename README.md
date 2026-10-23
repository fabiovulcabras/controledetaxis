# Controle de Táxis (Next.js + Supabase + WhatsApp)

Plataforma para registrar e validar as corridas de táxi pedidas pelas pessoas autorizadas.
Toda corrida nasce com um protocolo (`TX-2026-00123`), e só corrida com protocolo é aceita na conciliação da fatura do fornecedor.

## Como funciona

1. A pessoa autorizada manda mensagem para o número de WhatsApp da empresa.
2. O bot pergunta quando, origem, destino, passageiros, centro de custo e motivo, mostra o resumo e grava a corrida com protocolo.
3. O fornecedor recebe a corrida com os botões **Aceitar** e **Recusar**; o planejamento recebe um aviso.
4. Ao aceitar, o fornecedor informa motorista, placa e previsão; depois o embarque e o valor final.
5. Sem resposta no prazo, a corrida vira **Sem resposta** e o planejamento é avisado; ele pode reenviar a outro fornecedor pelo painel.
6. No fechamento, o planejamento importa a fatura (CSV), o sistema cruza cada cobrança com o protocolo e o planejamento aceita ou contesta.

Status: Solicitada → Aguardando fornecedor → Aceita → Em andamento → Concluída → Validada, com Recusada, Sem resposta, Cancelada e Contestada nos desvios.
As transições permitidas ficam no banco (`fn_transicao_valida`) e em `lib/status.ts`.

## Telas

| Tela | Perfil | O que faz |
| --- | --- | --- |
| Visão geral | todos | Números do dia, exceções, corridas aguardando fornecedor (com prazo), gráfico diário e valor por fornecedor e centro de custo. Atualiza sozinha (tempo real) |
| Corridas | todos | Lista com busca e filtros no servidor, paginação, exportação para Excel e cartões no celular; detalhe com dados, linha do tempo, mensagens e ações (validar, contestar, cancelar, reenviar, ajustar valor) |
| Relatórios | todos | Por período: taxa de aceite e tempo de resposta por fornecedor, gasto por pessoa (com % do limite mensal) e por centro de custo, exportação para Excel |
| Conciliação | planejamento | Importa a fatura (CSV ou Excel .xlsx), aceita todos os conciliados de uma vez, cruza com os protocolos, aceita/contesta itens, aponta corridas não faturadas, exporta a contestação |
| Pedido por link (`/pedir/…`) | pessoa autorizada, sem login | Pedido de táxi pelo celular, acompanhamento e cancelamento |
| Resposta do fornecedor (`/f/…`) | fornecedor, sem login | Aceitar com motorista, recusar, embarque e valor (mostra prazo, distância e tarifa de referência) |
| Portais dos fornecedores | planejamento | Link fixo do portal de cada fornecedor: enviar pelo WhatsApp, copiar, abrir ou gerar novo |
| Portal do fornecedor (`/fornecedor/…`) | fornecedor, sem login | Link fixo com todas as corridas do fornecedor: para responder, em andamento e encerradas |
| Cadastros | admin | Pessoas autorizadas, fornecedores, centros de custo, unidades, parâmetros e usuários do painel |

## Instalação

1. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor (uma vez). Depois rode as migrações numeradas na ordem (`supabase/002_links_whatsapp.sql`, `supabase/003_melhorias.sql`, `supabase/004_acesso_fornecedor.sql`), cada uma numa execução separada. A 003 também liga o tempo real (Realtime) para corridas, eventos e mensagens.
2. Opcional: rode `supabase/exemplo.sql` para ter unidade, centros de custo, dois fornecedores e três pessoas com números fictícios.
3. Copie `.env.example` para `.env.local` e preencha as chaves do Supabase. A `SUPABASE_SERVICE_ROLE_KEY` é secreta: só no servidor, nunca como `NEXT_PUBLIC_`.
4. `npm install && npm run dev`
5. Crie o primeiro usuário em Authentication › Users no Supabase (ou pela tela de login, se o cadastro estiver aberto). O primeiro usuário vira **administrador**; os demais entram como **consulta** e o admin muda o perfil em Cadastros › Usuários (ou convida por lá).
6. Em Cadastros › Parâmetros, informe `planejamento_telefones`.

Sem a Meta configurada (`WHATSAPP_MODO=simulado`), tudo funciona pelos links e botões de WhatsApp; as mensagens automáticas ficam gravadas no histórico de cada corrida.

## Hospedagem

O app é Next.js comum. Opções:
- **Vercel**: o plano Hobby é só para uso pessoal e não comercial; para uso da empresa, use o Pro.
- **Cloudflare Workers/Pages** ou outro host Node: configure as mesmas variáveis de ambiente.

## Pedido por link do WhatsApp (gratuito, sem API)

Funciona sem conta na Meta: o app monta a mensagem e o próprio WhatsApp de quem toca no botão envia (links `wa.me`).

1. Em **Cadastros › Pessoas autorizadas › Link de pedido**, envie a cada pessoa o link pessoal dela (`/pedir/<token>`). Ela salva na tela inicial do celular.
2. A pessoa abre o link, preenche o pedido e confirma. A corrida ganha protocolo e vai para o fornecedor no sistema.
3. Na confirmação, o botão **Enviar ao fornecedor pelo WhatsApp** abre o WhatsApp dela com a mensagem pronta, que traz o link de resposta do fornecedor (`/f/<token>`).
4. O fornecedor abre o link e aceita (informando motorista, placa e previsão) ou recusa; depois registra o embarque e o valor. A cada passo, a página oferece o botão para avisar o solicitante ou o planejamento pelo WhatsApp.
5. O planejamento acompanha tudo pelo painel. No detalhe da corrida há botões para mandar a corrida ao fornecedor, falar com ele ou com o solicitante, e as ações (reenviar, cancelar) devolvem os botões de aviso.

Os links funcionam como senha: quem tem o link pede em nome da pessoa (ou responde pelo fornecedor). **Gerar novo link** invalida o anterior, e uma corrida reenviada a outro fornecedor ganha link novo. Requer a migração `supabase/002_links_whatsapp.sql`.

Se a API oficial estiver ligada (`WHATSAPP_MODO=meta`), os mesmos pedidos por link também disparam as mensagens automáticas.

## Ligando o WhatsApp (Cloud API da Meta)

1. No Meta for Developers, crie um app do tipo Business com o produto WhatsApp e cadastre um número dedicado (que não esteja em uso no app comum). Faça a verificação da empresa no Meta Business.
2. Gere um token permanente (usuário do sistema) e copie o ID do número. Preencha `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` (uma frase aleatória sua), e mude `WHATSAPP_MODO=meta`.
3. Em WhatsApp › Configuração, aponte o webhook para `https://SEU-APP/api/whatsapp/webhook` com o mesmo verify token e assine o campo **messages**.
4. Cadastre os modelos abaixo (categoria Utilidade, idioma Português (BR)) com o texto exatamente igual ao de `lib/whatsapp/templates.ts`:

| Modelo | Para quem | Botões |
| --- | --- | --- |
| `nova_corrida_fornecedor` | fornecedor, corrida nova | Resposta rápida: Aceitar, Recusar |
| `corrida_cancelada_fornecedor` | fornecedor, cancelamento | — |
| `nova_corrida_planejamento` | planejamento, cada corrida | — |
| `alerta_corrida_planejamento` | planejamento, exceções | — |
| `atualizacao_corrida_solicitante` | solicitante, avisos fora da janela de 24 h | — |
| `lembrete_corrida_solicitante` | solicitante, antes da corrida agendada | — |

Mensagens que o bot inicia (fornecedor e planejamento) sempre saem como modelo. Avisos ao solicitante saem como texto livre se ele falou com o bot nas últimas 24 h; senão, como modelo. A Meta cobra por modelo entregue.

## Agendador (prazos e lembretes)

`/api/cron/prazos` marca como **Sem resposta** as corridas com prazo vencido e envia lembretes das agendadas. Rode a cada 1–5 minutos com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.
A forma gratuita é o próprio Supabase: veja `supabase/agendador.sql` (pg_cron + pg_net). No Vercel Pro, também dá para usar o Vercel Cron.

## Testes

- `npm test` — motor do bot (fluxo completo do solicitante e do fornecedor, prazos, lembretes, leitura de datas, valores, telefones e CSV), com um repositório em memória.
- `npm run test:db` — regras do banco num Postgres comum (protocolo, transições, permissões por perfil, conciliação). Usa as variáveis padrão do `psql`.
- O GitHub Actions roda os dois, mais typecheck e build, a cada push.

## Estrutura

```
app/                     telas (Next.js App Router) e rotas de API
  api/whatsapp/webhook   recebe mensagens da Meta
  api/corridas/acao      ações do planejamento sobre uma corrida
  api/cron/prazos        agendador
  api/usuarios           convite de usuários (admin)
  api/pedido, api/fornecedor, api/portal  rotas públicas dos links (com token e limite de tentativas)
  api/endereco           endereço escrito da localização e sugestões (OpenStreetMap)
  api/saude              diagnóstico da configuração
lib/bot/motor.ts         máquina de conversa do bot (solicitante e fornecedor)
lib/bot/acoes.ts         despachar, cancelar, alertar, prazos, lembretes
lib/bot/repo-supabase.ts acesso a dados do bot
lib/whatsapp/            modelos, montagem do payload da Meta e envio
supabase/schema.sql      tabelas, funções, RLS
supabase/00N_*.sql       migrações, rodar na ordem
supabase/tests/          cenários de teste do banco
tests/                   testes do motor do bot
```

## Regras principais

- Só números cadastrados e ativos em Pessoas autorizadas pedem táxi. Número desconhecido recebe recusa e o planejamento é avisado (no máximo uma vez por dia por número).
- O WhatsApp às vezes entrega celulares brasileiros sem o nono dígito; a busca considera as duas formas.
- Conversa parada por mais de `conversa_expira_min` minutos é descartada. Três respostas não entendidas voltam ao menu.
- Fornecedor: o padrão da pessoa autorizada; sem padrão, o ativo de menor número em Prioridade.
- Prazo de resposta: o do fornecedor para corridas imediatas; `prazo_agendada_min` para agendadas. O fornecedor ainda pode aceitar depois do prazo, e o planejamento é avisado.
- Valor acima do teto do centro de custo gera alerta. Também geram alerta: valor acima da tarifa de referência do fornecedor (`bandeirada` + `valor_km` × distância, mais `tolerancia_trajeto_pct`) e gasto da pessoa acima do `limite_mensal` dela.
- Só o fornecedor responde: o link `/f/…` da corrida passa pelo WhatsApp do solicitante, então sozinho ele só mostra a corrida. Aceitar, recusar, informar valor ou marcar como não realizada exige o aparelho identificado, abrindo o portal do fornecedor ou digitando o código de acesso de 6 dígitos (tela Portais dos fornecedores). Gerar novo link do portal desliga os aparelhos já identificados.
- Recusa ou falta de resposta reenvia sozinha ao próximo fornecedor ativo ainda não tentado (parâmetro `reenvio_automatico`; `nao` desliga).
- Pedido por link: no máximo `limite_pedidos_hora` por pessoa por hora; o mesmo pedido enviado duas vezes (clique duplo, rede instável) cria uma corrida só. As rotas públicas têm limite de tentativas por minuto.
- E-mail ao planejamento (opcional): defina `RESEND_API_KEY` e `EMAIL_REMETENTE` e preencha o parâmetro `planejamento_emails`.
- Conciliação: dentro da tolerância (`tolerancia_pct` ou `tolerancia_valor`, o maior) = conciliado. Também aponta sem protocolo, corrida cancelada, outro fornecedor e cobrança duplicada. Aceitar valida a corrida; contestar marca como contestada.
- Corrida validada só volta a contestada com justificativa. Toda mudança fica em `corrida_eventos` com origem e usuário.
