-- Corrige dois bugs que precisavam de mudança no banco:
--  1) O badge de não lidas contava mensagens de conversas já ocultadas
--  2) O cadastro não tinha como gravar o nome do usuário
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== 1) contagem de não lidas respeita conversa ocultada ==========
-- utils/chat.ts contava direto em "mensagens" (lido_em is null + remetente
-- diferente de mim) e deixava a RLS filtrar o resto. Só que a RLS filtra por
-- participação na conversa, não pelas colunas oculta_participante_* — então o
-- badge da tab bar somava conversas que a lista de /chat já não mostra mais, e
-- os dois números nunca batiam. A contagem passa a ser feita aqui, junto do
-- mesmo filtro que a tela usa.
-- security invoker de propósito: a RLS de mensagens/conversas continua valendo,
-- esta função só acrescenta o filtro de ocultas por cima.
create or replace function public.contar_mensagens_nao_lidas()
returns integer
language sql
stable
security invoker
as $$
  select count(*)::int
  from public.mensagens m
  join public.conversas c on c.id = m.conversa_id
  where m.remetente_id <> auth.uid()
    and m.lido_em is null
    and (
      (c.participante_1_id = auth.uid() and not c.oculta_participante_1)
      or (c.participante_2_id = auth.uid() and not c.oculta_participante_2)
    );
$$;

revoke execute on function public.contar_mensagens_nao_lidas() from public, anon;
grant execute on function public.contar_mensagens_nao_lidas() to authenticated;

-- ========== 2) cadastro grava o nome ==========
-- A tela de criar conta só mandava e-mail e senha, então nome_completo nascia
-- null e todo usuário novo aparecia como "Sem nome" / "Alguém" pelo app até
-- editar o perfil. O trigger já lia "telefone" de raw_user_meta_data desde a
-- 0002 — é o mesmo caminho, agora também pra nome_completo (vem de
-- options.data.nome_completo no supabase.auth.signUp).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, telefone, nome_completo)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'telefone',
    nullif(trim(new.raw_user_meta_data ->> 'nome_completo'), '')
  );
  return new;
end;
$$;
