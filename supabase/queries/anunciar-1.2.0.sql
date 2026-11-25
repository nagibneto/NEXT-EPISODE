-- Anuncia a versão 1.2.0 (modo Games) para o modal de atualização (tabela
-- app_releases, ver supabase/schema.sql e ATUALIZACAO-E-AVALIACAO.md).
--
-- QUANDO RODAR: só depois de a 1.2.0 estar aprovada e VISÍVEL nas duas lojas.
-- Rodar antes manda a pessoa para uma ficha que ainda mostra a versão velha.
--
-- O modal só aparece se UPDATE_PROMPT_ENABLED estiver ligado (src/lib/app-update.ts).

insert into public.app_releases (version, mandatory, highlights) values (
  '1.2.0',
  false,
  '{
    "pt-BR": [
      "Novo modo Games: toque no controle no topo da tela",
      "Biblioteca de jogos com Jogando, Quero jogar, Zerei e Joguei",
      "Dê nota e comente jogos, igual nos filmes",
      "Vincule Steam, PlayStation e Xbox e veja suas conquistas"
    ],
    "en-US": [
      "New Games mode: tap the controller at the top of the screen",
      "A game Library with Playing, Want to play, Beaten and Played",
      "Rate and comment on games, just like movies",
      "Link Steam, PlayStation and Xbox to see your achievements"
    ]
  }'::jsonb
)
on conflict (version) do update
  set highlights = excluded.highlights,
      mandatory = excluded.mandatory;

-- Conferir:
--   select version, platform, mandatory, released_at from public.app_releases
--   order by released_at desc;
