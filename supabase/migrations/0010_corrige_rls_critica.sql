-- Corrige 5 falhas críticas de RLS encontradas em auditoria:
--  1) Mensagens podiam ser adulteradas por qualquer participante da conversa
--  2) Conversa podia ser sequestrada (trocar o outro participante / o bico)
--  3) Candidato podia se autoaprovar numa candidatura (bypass de escolher_candidato)
--  4) Qualquer usuário podia abrir conversa com qualquer outro, sem vínculo com o bico
--  5) Bico não tinha máquina de estados (valor/status podiam ser alterados livremente)
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== 1) mensagens: só o campo lido_em pode ser atualizado ==========
-- A policy de UPDATE (0007) não tinha WITH CHECK, então qualquer participante
-- da conversa conseguia reescrever "conteudo" e "remetente_id" de mensagens
-- alheias. Trava por coluna: agora só é permitido fazer UPDATE de lido_em.
revoke update on public.mensagens from authenticated;
grant update (lido_em) on public.mensagens to authenticated;

-- ========== 2) conversas: só os campos de ocultar podem ser atualizados ==========
-- A policy de UPDATE (0009) permitia trocar participante_1_id/participante_2_id/
-- bico_id, desde que o próprio usuário continuasse como participante depois —
-- ou seja, dava pra expulsar a outra pessoa e colocar um terceiro na conversa.
revoke update on public.conversas from authenticated;
grant update (oculta_participante_1, oculta_participante_2) on public.conversas to authenticated;

-- ========== 3) candidaturas: candidato não pode mais se autoaprovar ==========
-- A policy antiga deixava o próprio candidato mudar o "status" da candidatura
-- pra 'aceita', pulando a regra de negócio que só existe dentro da função
-- escolher_candidato() (que só o dono do bico pode chamar).
drop policy if exists "Candidato ou dono do bico podem atualizar a candidatura" on public.candidaturas;

create policy "Dono do bico aceita ou recusa candidatura"
  on public.candidaturas for update
  to authenticated
  using (
    exists (select 1 from public.bicos b where b.id = bico_id and b.criado_por = auth.uid())
  )
  with check (
    exists (select 1 from public.bicos b where b.id = bico_id and b.criado_por = auth.uid())
    and status in ('aceita', 'recusada')
  );

create policy "Candidato retira a propria candidatura"
  on public.candidaturas for update
  to authenticated
  using (auth.uid() = candidato_id and status = 'pendente')
  with check (auth.uid() = candidato_id and status = 'retirada');

-- Só o status pode mudar (nem candidato nem dono devem poder editar "mensagem").
revoke update on public.candidaturas from authenticated;
grant update (status) on public.candidaturas to authenticated;

-- Também trava candidatura em bico que não está mais aberto.
drop policy if exists "Usuário autenticado pode se candidatar" on public.candidaturas;

create policy "Usuário autenticado pode se candidatar"
  on public.candidaturas for insert
  to authenticated
  with check (
    auth.uid() = candidato_id
    and exists (select 1 from public.bicos b where b.id = bico_id and b.status = 'aberto')
  );

-- ========== 4) conversas: só pode existir entre dono e candidato selecionado ==========
-- A policy antiga de INSERT só exigia que o usuário fosse um dos dois
-- participantes, sem checar se ele tinha qualquer vínculo com o bico —
-- permitia iniciar conversa (e mandar mensagem) com qualquer pessoa cadastrada.
drop policy if exists "Participante pode criar conversa" on public.conversas;

create policy "Participante pode criar conversa"
  on public.conversas for insert
  to authenticated
  with check (
    (auth.uid() = participante_1_id or auth.uid() = participante_2_id)
    and exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and b.candidato_selecionado_id is not null
        and (
          (b.criado_por = participante_1_id and b.candidato_selecionado_id = participante_2_id)
          or (b.criado_por = participante_2_id and b.candidato_selecionado_id = participante_1_id)
        )
    )
  );

-- ========== 5) bicos: trava valor/forma de pagamento e transições de status ==========
-- Antes o dono podia mudar valor_oferecido ou forma_pagamento a qualquer
-- momento (mesmo com candidato já em andamento) e pular etapas de status
-- (ex: de "aberto" direto pra "concluido", sem nunca escolher candidato).
create or replace function public.validar_transicao_bico()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'aberto' and (
    new.valor_oferecido is distinct from old.valor_oferecido
    or new.forma_pagamento is distinct from old.forma_pagamento
  ) then
    raise exception 'Não é possível alterar valor ou forma de pagamento depois que o bico sai de "aberto".';
  end if;

  if new.status <> old.status and not (
    (old.status = 'aberto' and new.status in ('em_andamento', 'cancelado'))
    or (old.status = 'em_andamento' and new.status in ('concluido', 'cancelado'))
  ) then
    raise exception 'Transição de status inválida: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists bicos_validar_transicao on public.bicos;

create trigger bicos_validar_transicao
  before update on public.bicos
  for each row execute function public.validar_transicao_bico();
