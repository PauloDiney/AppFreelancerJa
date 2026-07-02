-- Corrige os 3 itens "altos" da auditoria:
--  6) Autoavaliação e papel_avaliado forjado não eram bloqueados
--  7) Fechar bico + avaliar não era atômico (duas chamadas separadas do cliente)
--  8) Telefone e localização exata visíveis pra qualquer usuário autenticado
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== 6) avaliacoes: sem autoavaliação e sem papel forjado ==========
-- A policy antiga só checava "bico concluído + eu participei dele", sem
-- garantir que avaliado_id fosse de fato a outra pessoa do bico, nem que
-- papel_avaliado batesse com o papel real de quem está sendo avaliado.
drop policy if exists "Só quem participou do bico concluído pode avaliar" on public.avaliacoes;

create policy "Só quem participou do bico concluído pode avaliar"
  on public.avaliacoes for insert
  to authenticated
  with check (
    auth.uid() = avaliador_id
    and avaliado_id <> avaliador_id
    and exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and b.status = 'concluido'
        and (
          (b.criado_por = auth.uid() and b.candidato_selecionado_id = avaliado_id and papel_avaliado = 'prestador')
          or (b.candidato_selecionado_id = auth.uid() and b.criado_por = avaliado_id and papel_avaliado = 'contratante')
        )
    )
  );

-- ========== 7) fechar bico + avaliar prestador numa transação só ==========
-- Antes o app fazia "update bicos" e "insert avaliacoes" como duas chamadas
-- separadas: se a segunda falhasse (ex: avaliação duplicada), o bico ficava
-- concluído sem avaliação e sem a mensagem de encerramento no chat.
create or replace function public.fechar_bico_e_avaliar(
  p_bico_id uuid,
  p_nota integer,
  p_comentario text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_candidato_id uuid;
  v_conversa_id uuid;
begin
  if p_nota not between 1 and 5 then
    raise exception 'Nota inválida.';
  end if;

  select candidato_selecionado_id into v_candidato_id
  from public.bicos
  where id = p_bico_id and criado_por = auth.uid() and status = 'em_andamento';

  if v_candidato_id is null then
    raise exception 'Este bico não está em andamento ou você não é o contratante.';
  end if;

  update public.bicos set status = 'concluido' where id = p_bico_id;

  insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota, comentario)
  values (p_bico_id, auth.uid(), v_candidato_id, 'prestador', p_nota, p_comentario);

  select id into v_conversa_id
  from public.conversas
  where bico_id = p_bico_id
    and (
      (participante_1_id = auth.uid() and participante_2_id = v_candidato_id)
      or (participante_1_id = v_candidato_id and participante_2_id = auth.uid())
    )
  limit 1;

  if v_conversa_id is not null then
    insert into public.mensagens (conversa_id, remetente_id, conteudo)
    values (v_conversa_id, auth.uid(), 'Serviço marcado como concluído. 🎉');
  end if;
end;
$$;

-- ========== 8) profiles: telefone e localização exata deixam de ser públicos ==========
-- RLS é por linha, não por coluna — a policy "using(true)" deixava telefone e
-- localizacao_atual (coordenadas exatas) de qualquer usuário visíveis pra
-- qualquer outra conta autenticada. Trava por coluna: authenticated só
-- consegue ler as colunas de perfil "públicas" do app.
revoke select on public.profiles from authenticated;
grant select (
  id, nome_completo, foto_url, biografia, telefone_verificado,
  nota_media_como_prestador, nota_media_como_contratante,
  total_bicos_como_prestador, total_bicos_como_contratante,
  status_conta, criado_em, email
) on public.profiles to authenticated;

-- O dono do perfil ainda precisa ler o próprio telefone pra poder editá-lo.
-- security definer + filtro por auth.uid() dentro da função: só devolve o
-- telefone de quem está chamando, nunca o de outra pessoa.
create or replace function public.meu_telefone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select telefone from public.profiles where id = auth.uid();
$$;
