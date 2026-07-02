-- Faltava uma policy de UPDATE em mensagens: sem ela, marcar lido_em não fazia nada
-- (0 linhas afetadas, sem erro). Cole este arquivo inteiro no SQL Editor do Supabase e rode.

create policy "Participante da conversa pode marcar mensagem como lida"
  on public.mensagens for update
  to authenticated
  using (
    exists (
      select 1 from public.conversas c
      where c.id = conversa_id
        and (c.participante_1_id = auth.uid() or c.participante_2_id = auth.uid())
    )
  );
