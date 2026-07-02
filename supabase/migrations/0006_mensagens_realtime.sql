-- Liga o realtime na tabela de mensagens (pro chat atualizar sem precisar recarregar a tela)
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens'
  ) then
    alter publication supabase_realtime add table public.mensagens;
  end if;
end $$;
