-- Anuncia a versão 1.0.7 para o modal de atualização (tabela app_releases,
-- ver supabase/schema.sql e ATUALIZACAO-E-AVALIACAO.md).
--
-- QUANDO RODAR: só depois de a 1.0.7 estar aprovada e VISÍVEL nas duas lojas.
-- Rodar antes manda a pessoa para uma ficha que ainda mostra a versão velha.
-- Se uma loja liberar antes da outra, rode a variante do fim do arquivo.
--
-- Nesta versão o modal ainda não alcança ninguém: quem está na 1.0.6 não tem o
-- código dele instalado. A linha serve para deixar o histórico completo e para
-- conferir, em produção, que a tabela e a RLS estão de pé — o aviso passa a
-- funcionar de verdade da 1.0.8 em diante.

insert into public.app_releases (version, mandatory, highlights) values (
  '1.0.7',
  false,
  '{
    "pt-BR": [
      "Widget na tela de início com o que falta assistir",
      "Marque episódio como assistido sem abrir o app",
      "Próximas estreias e o quiz do dia no widget",
      "Botão de avaliar o app no perfil"
    ],
    "en-US": [
      "Home screen widget with what you still have to watch",
      "Mark an episode as watched without opening the app",
      "Upcoming premieres and the daily quiz in the widget",
      "A rate-the-app button in your profile"
    ]
  }'::jsonb
)
on conflict (version) do update
  set highlights = excluded.highlights,
      mandatory = excluded.mandatory;

-- Conferir:
--   select version, platform, mandatory, released_at from public.app_releases
--   order by released_at desc;

-- ---------------------------------------------------------------------------
-- Variante: uma loja aprovou e a outra não
-- ---------------------------------------------------------------------------
-- Troque o insert acima por este, com a plataforma que já liberou, e rode de
-- novo com a outra quando ela sair. (São duas linhas com a MESMA versão, o que
-- a chave primária não permite — então, na prática, use a linha única acima e
-- só espere as duas lojas. Esta variante existe para o caso de a segunda loja
-- demorar dias: aí vale anunciar para quem já pode atualizar.)
--
--   update public.app_releases set platform = 'ios' where version = '1.0.7';
--   -- quando a Play Store liberar:
--   update public.app_releases set platform = null where version = '1.0.7';
