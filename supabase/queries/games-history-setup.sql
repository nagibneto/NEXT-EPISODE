-- Status "Joguei" (played) na coleção de games, usado pela importação do
-- histórico completo (Steam/PSN/Xbox). Rodar UMA vez no SQL Editor;
-- idempotente. Mesmo conteúdo do fim de supabase/schema.sql.
alter table public.game_library
  drop constraint if exists game_library_status_check;
alter table public.game_library
  add constraint game_library_status_check
  check (status in ('want', 'playing', 'completed', 'dropped', 'played'));
