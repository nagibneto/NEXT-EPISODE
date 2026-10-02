-- Anuncia a versão 1.0.8 para o modal de atualização (tabela app_releases,
-- ver supabase/schema.sql e ATUALIZACAO-E-AVALIACAO.md).
--
-- QUANDO RODAR: só depois de a 1.0.8 estar aprovada e VISÍVEL nas duas lojas.
-- Rodar antes manda a pessoa para uma ficha que ainda mostra a versão velha.
--
-- O modal só aparece se UPDATE_PROMPT_ENABLED estiver ligado (src/lib/app-update.ts);
-- na 1.0.8 ele continua desligado, então a linha fica de histórico até lá.

insert into public.app_releases (version, mandatory, highlights) values (
  '1.0.8',
  false,
  '{
    "pt-BR": [
      "Nova aba Para você, com indicações do seu gosto",
      "Veja só o que está nos streamings que você assina",
      "Em alta, lançamentos, mais bem avaliados e por gênero",
      "Botão + para seguir série ou guardar filme direto da aba"
    ],
    "en-US": [
      "New For you tab, with picks for your taste",
      "See only what is on the streaming services you pay for",
      "Trending, new releases, top rated and by genre",
      "A + button to follow a show or save a movie right from the tab"
    ]
  }'::jsonb
)
on conflict (version) do update
  set highlights = excluded.highlights,
      mandatory = excluded.mandatory;

-- Conferir:
--   select version, platform, mandatory, released_at from public.app_releases
--   order by released_at desc;
