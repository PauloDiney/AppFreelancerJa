-- Oculta a conversa só do lado de quem arrastou (não apaga de verdade, não
-- afeta a outra pessoa). Só permitido quando o bico já está concluído.
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

alter table public.conversas
  add column oculta_participante_1 boolean not null default false,
  add column oculta_participante_2 boolean not null default false;

create policy "Participante pode ocultar a própria conversa"
  on public.conversas for update
  to authenticated
  using (participante_1_id = auth.uid() or participante_2_id = auth.uid())
  with check (participante_1_id = auth.uid() or participante_2_id = auth.uid());
