-- Corrige o UPDATE de profiles, que ficou de fora das migrations 0010/0011:
--  9) Usuário podia reescrever qualquer coluna do próprio perfil — inclusive
--     reputação, telefone_verificado e status_conta (sair de 'banido' sozinho)
-- 10) Reputação (nota_media_* / total_bicos_*) nunca era calculada pelo banco
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== 9) profiles: só as colunas que as telas editam podem ser atualizadas ==========
-- A policy de UPDATE (0001) só checava "auth.uid() = id" e o grant de UPDATE
-- nunca foi restringido. RLS é por linha, não por coluna — então o dono do
-- perfil conseguia reescrever a própria linha inteira: nota_media_como_* e
-- total_bicos_como_* (forjar reputação), telefone_verificado (se autoverificar)
-- e status_conta (sair de 'banido' ou 'suspenso' pra 'ativo' sem moderação).
-- Trava por coluna, igual mensagens/conversas/candidaturas na 0010: só ficam
-- liberadas as colunas que editar-perfil e dados-pessoais realmente gravam.
-- localizacao_atual fica de fora porque nenhuma tela grava essa coluna hoje
-- (liberar aqui quando a busca por proximidade usar a posição do usuário), e
-- email também, porque vem de auth.users via handle_new_user, não do app.
revoke update on public.profiles from authenticated;
grant update (
  nome_completo, foto_url, biografia, telefone,
  tipo_cadastro, cpf, cnpj, data_nascimento, sexo, cep, cidade, uf, bairro
) on public.profiles to authenticated;

-- ========== 10) reputação recalculada pelo banco a partir de avaliacoes ==========
-- nota_media_como_* e total_bicos_como_* existem desde a 0001, mas nenhuma
-- migration preenchia — ficavam paradas no default (ou com o que o próprio
-- usuário quisesse gravar, pelo buraco do item 9). Agora são recalculadas a
-- cada avaliação inserida (ou removida, pra moderação futura), sempre a partir
-- das linhas reais de avaliacoes, separando por papel_avaliado.
-- security definer + search_path fixo (igual handle_new_user): o insert em
-- avaliacoes roda como authenticated — pelo app ou por fechar_bico_e_avaliar,
-- que é security invoker — e authenticated não tem mais update nessas colunas.
create or replace function public.recalcular_reputacao(p_usuario_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  -- Agregado sem group by sempre devolve uma linha: sem avaliações a média
  -- vira null e o total vira 0, os mesmos defaults da 0001 — então apagar a
  -- última avaliação devolve o perfil ao estado inicial.
  update public.profiles p
  set nota_media_como_prestador    = r.media_prestador,
      total_bicos_como_prestador   = r.total_prestador,
      nota_media_como_contratante  = r.media_contratante,
      total_bicos_como_contratante = r.total_contratante
  from (
    select
      round(avg(nota) filter (where papel_avaliado = 'prestador'), 2)   as media_prestador,
      count(*)        filter (where papel_avaliado = 'prestador')       as total_prestador,
      round(avg(nota) filter (where papel_avaliado = 'contratante'), 2) as media_contratante,
      count(*)        filter (where papel_avaliado = 'contratante')     as total_contratante
    from public.avaliacoes
    where avaliado_id = p_usuario_id
  ) r
  where p.id = p_usuario_id;
$$;

-- Não é pra ser chamada como RPC pelo app, só pelo trigger abaixo.
revoke execute on function public.recalcular_reputacao(uuid) from public, anon, authenticated;

-- Também security definer: roda como authenticated no insert, que não tem
-- mais execute na função acima.
create or replace function public.avaliacoes_recalcular_reputacao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalcular_reputacao(old.avaliado_id);
    return old;
  end if;

  perform public.recalcular_reputacao(new.avaliado_id);
  return new;
end;
$$;

drop trigger if exists avaliacoes_recalcular_reputacao on public.avaliacoes;

create trigger avaliacoes_recalcular_reputacao
  after insert or delete on public.avaliacoes
  for each row execute function public.avaliacoes_recalcular_reputacao();

-- Recalcula todos os perfis uma vez (não só quem tem avaliação): preenche a
-- reputação de quem já tinha sido avaliado e zera qualquer valor que tenha
-- sido forjado pelo buraco do item 9 antes desta migration.
select public.recalcular_reputacao(id) from public.profiles;
