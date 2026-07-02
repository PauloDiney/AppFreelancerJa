-- Escolhe um candidato para o bico: aceita a candidatura dele, recusa as outras
-- pendentes e marca o bico como em_andamento. Tudo em uma transação só.
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

create or replace function public.escolher_candidato(p_bico_id uuid, p_candidato_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (
    select 1 from public.bicos
    where id = p_bico_id and criado_por = auth.uid() and status = 'aberto'
  ) then
    raise exception 'Este bico não está mais disponível para escolher candidatos.';
  end if;

  update public.candidaturas
  set status = 'aceita'
  where bico_id = p_bico_id and candidato_id = p_candidato_id;

  update public.candidaturas
  set status = 'recusada'
  where bico_id = p_bico_id and candidato_id <> p_candidato_id and status = 'pendente';

  update public.bicos
  set candidato_selecionado_id = p_candidato_id, status = 'em_andamento'
  where id = p_bico_id;
end;
$$;
