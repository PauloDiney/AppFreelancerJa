-- Corrige as falhas de RLS que sobraram na tabela "bicos" — a única que nunca
-- passou pelo tratamento de coluna que as migrations 0010/0011/0014 deram em
-- mensagens, conversas, candidaturas, avaliacoes e profiles:
--  1) candidato_selecionado_id era forjável → conversa/DM com qualquer usuário
--  2) escolher_candidato() não checava se a candidatura existe
--  3) localizacao (GPS exato do serviço) era legível por qualquer autenticado
--  4) profiles.email era legível por qualquer autenticado (base enumerável)
--  5) status_conta ('suspenso'/'banido') não era consultado por policy nenhuma
--  6) nenhum campo de texto tinha limite de tamanho
--  7) bucket de avatares sem limite de tamanho nem de tipo de arquivo
--  8) chaves_pix podia ficar sem nenhuma chave principal
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== 1) bicos: candidato_selecionado_id não pode ser forjado ==========
-- A 0010 (item 4) fechou o furo de "conversa com qualquer um" exigindo que a
-- conversa só exista entre criado_por e candidato_selecionado_id do bico. Mas
-- bicos nunca teve restrição de coluna no UPDATE e o trigger de transição não
-- olhava candidato_selecionado_id, então dava pra reabrir o mesmo furo por
-- outro caminho:
--
--   update bicos set status='em_andamento', candidato_selecionado_id='<vítima>'
--   where id='<meu bico>';   -- transição aberto→em_andamento é válida
--   insert into conversas (...);  -- a policy da 0010 aprova, o par confere
--
-- Além do DM não solicitado, o mesmo buraco permitia trocar o prestador com o
-- serviço já em andamento — o original perdia o registro e
-- fechar_bico_e_avaliar() acabava avaliando a pessoa errada.
--
-- A trava vai no trigger (e não na policy) de propósito: assim vale tanto pro
-- update direto quanto pra RPC escolher_candidato(), que é security invoker.
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

  if new.candidato_selecionado_id is distinct from old.candidato_selecionado_id then
    if old.candidato_selecionado_id is not null then
      raise exception 'O prestador escolhido não pode ser trocado.';
    end if;

    if new.candidato_selecionado_id is not null and not exists (
      select 1 from public.candidaturas c
      where c.bico_id = new.id and c.candidato_id = new.candidato_selecionado_id
    ) then
      raise exception 'Só é possível escolher alguém que se candidatou a este bico.';
    end if;
  end if;

  return new;
end;
$$;

-- ========== 2) escolher_candidato: valida a candidatura antes de gravar ==========
-- Os updates em candidaturas usam "where candidato_id = p_candidato_id": se
-- ninguém se candidatou, afetam 0 linhas sem erro e a função seguia em frente
-- gravando candidato_selecionado_id assim mesmo. O trigger acima já barra isso,
-- mas com uma mensagem genérica — este check devolve o motivo certo.
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

  if not exists (
    select 1 from public.candidaturas
    where bico_id = p_bico_id and candidato_id = p_candidato_id and status = 'pendente'
  ) then
    raise exception 'Esse candidato não está mais disponível para este bico.';
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

-- ========== 3) bicos: localizacao exata deixa de ser pública ==========
-- Mesma lógica da 0011 item 8 (que fez isso em profiles), agora em bicos.
-- criar-bico.tsx grava a posição real do usuário em "localizacao" — que muitas
-- vezes é a casa do contratante — e RLS é por linha, não por coluna: a policy
-- "using (true)" deixava qualquer conta autenticada rodar
-- "select localizacao from bicos" e ter a coordenada exata de todo serviço.
revoke select on public.bicos from authenticated;
grant select (
  id, criado_por, categoria_id, titulo, descricao, endereco_texto,
  valor_oferecido, forma_pagamento, data_hora_desejada, status,
  candidato_selecionado_id, criado_em, atualizado_em
) on public.bicos to authenticated;

-- bicos_proximos era "select b.*" com security invoker, então quebraria com o
-- grant por coluna acima. Vira security definer (search_path fixo, igual
-- handle_new_user) e devolve a DISTÂNCIA em metros no lugar do ponto: é o que
-- a tela precisa mostrar, e não vaza a coordenada de volta pro cliente.
drop function if exists public.bicos_proximos(double precision, double precision, integer);

create function public.bicos_proximos(
  lat double precision,
  lng double precision,
  raio_metros integer default 10000
)
returns table (
  id uuid,
  criado_por uuid,
  categoria_id integer,
  titulo text,
  descricao text,
  endereco_texto text,
  valor_oferecido numeric,
  forma_pagamento text,
  data_hora_desejada timestamptz,
  status text,
  criado_em timestamptz,
  distancia_metros double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.criado_por, b.categoria_id, b.titulo, b.descricao, b.endereco_texto,
    b.valor_oferecido, b.forma_pagamento, b.data_hora_desejada, b.status, b.criado_em,
    extensions.ST_Distance(
      b.localizacao,
      extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
    ) as distancia_metros
  from public.bicos b
  where b.status = 'aberto'
    and b.localizacao is not null
    and extensions.ST_DWithin(
      b.localizacao,
      extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography,
      raio_metros
    )
  order by distancia_metros;
$$;

-- security definer ignora RLS, então quem pode chamar precisa ser explícito.
revoke execute on function public.bicos_proximos(double precision, double precision, integer) from public, anon;
grant execute on function public.bicos_proximos(double precision, double precision, integer) to authenticated;

-- ========== 4) profiles: e-mail deixa de ser legível por outras contas ==========
-- A 0011 listou "email" entre as colunas públicas do perfil, mas o app só lê o
-- e-mail do PRÓPRIO usuário (dados-pessoais.tsx) — e essa tela já tem o valor
-- em auth.getUser(). Enquanto o grant existia, qualquer conta autenticada
-- rodava "select id, email from profiles" e levava a base inteira.
revoke select (email) on public.profiles from authenticated;

-- ========== 5) status_conta passa a valer alguma coisa ==========
-- 'suspenso' e 'banido' existem desde a 0001 e a 0014 impediu o usuário de se
-- auto-desbanir — mas nenhuma policy consultava a coluna, então um banido
-- continuava criando bico, se candidatando e mandando mensagem normalmente.
-- security definer porque a checagem precisa funcionar independente do que
-- authenticated consegue ler de profiles hoje ou depois.
create or replace function public.conta_ativa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status_conta = 'ativo' from public.profiles where id = auth.uid()), false);
$$;

revoke execute on function public.conta_ativa() from public, anon;
grant execute on function public.conta_ativa() to authenticated;

drop policy if exists "Usuário autenticado pode criar bico" on public.bicos;

create policy "Usuário autenticado pode criar bico"
  on public.bicos for insert
  to authenticated
  with check (auth.uid() = criado_por and public.conta_ativa());

drop policy if exists "Usuário autenticado pode se candidatar" on public.candidaturas;

create policy "Usuário autenticado pode se candidatar"
  on public.candidaturas for insert
  to authenticated
  with check (
    auth.uid() = candidato_id
    and public.conta_ativa()
    and exists (select 1 from public.bicos b where b.id = bico_id and b.status = 'aberto')
  );

drop policy if exists "Participante da conversa pode enviar mensagem" on public.mensagens;

create policy "Participante da conversa pode enviar mensagem"
  on public.mensagens for insert
  to authenticated
  with check (
    auth.uid() = remetente_id
    and public.conta_ativa()
    and exists (
      select 1 from public.conversas c
      where c.id = conversa_id
        and (c.participante_1_id = auth.uid() or c.participante_2_id = auth.uid())
    )
  );

drop policy if exists "Só quem participou do bico concluído pode avaliar" on public.avaliacoes;

create policy "Só quem participou do bico concluído pode avaliar"
  on public.avaliacoes for insert
  to authenticated
  with check (
    auth.uid() = avaliador_id
    and avaliado_id <> avaliador_id
    and public.conta_ativa()
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

-- ========== 6) limites de tamanho nos campos de texto livre ==========
-- titulo, descricao, biografia, conteudo e comentario eram "text" sem check
-- nenhum: uma mensagem de 10 MB era aceita sem reclamação. valor_oferecido
-- também não tinha teto.
alter table public.bicos
  add constraint bicos_titulo_tamanho check (char_length(titulo) between 3 and 120),
  add constraint bicos_descricao_tamanho check (descricao is null or char_length(descricao) <= 2000),
  add constraint bicos_endereco_tamanho check (endereco_texto is null or char_length(endereco_texto) <= 200),
  add constraint bicos_valor_faixa check (valor_oferecido is null or (valor_oferecido > 0 and valor_oferecido <= 100000));

alter table public.mensagens
  add constraint mensagens_conteudo_tamanho check (char_length(conteudo) between 1 and 2000);

alter table public.profiles
  add constraint profiles_biografia_tamanho check (biografia is null or char_length(biografia) <= 500),
  add constraint profiles_nome_tamanho check (nome_completo is null or char_length(nome_completo) <= 120);

alter table public.avaliacoes
  add constraint avaliacoes_comentario_tamanho check (comentario is null or char_length(comentario) <= 1000);

-- ========== 7) bucket de avatares: limite de tamanho e de tipo ==========
-- A 0005 restringiu a pasta por auth.uid(), mas sem limite nenhum de arquivo:
-- dava pra subir qualquer coisa, de qualquer tamanho. SVG fica de fora da lista
-- de propósito — bucket público servindo SVG inline é vetor de XSS no build web.
update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'avatars';

-- ========== 8) chaves_pix: a invariante "sempre uma principal" fica de pé ==========
-- Os triggers da 0013 cobrem insert e delete, mas authenticated tinha UPDATE em
-- todas as colunas — dava pra marcar principal = false na única chave e ficar
-- sem nenhuma principal. Agora "principal" só muda pela RPC abaixo.
revoke update on public.chaves_pix from authenticated;
grant update (tipo, valor, banco_nome) on public.chaves_pix to authenticated;

-- security definer porque authenticated perdeu o update em "principal" acima.
-- Os dois filtros por auth.uid() continuam: só mexe nas chaves de quem chama.
create or replace function public.definir_chave_pix_principal(p_chave_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.chaves_pix where id = p_chave_id and usuario_id = auth.uid()) then
    raise exception 'Essa chave Pix não é sua.';
  end if;

  update public.chaves_pix set principal = false where usuario_id = auth.uid() and principal;
  update public.chaves_pix set principal = true where id = p_chave_id and usuario_id = auth.uid();
end;
$$;

revoke execute on function public.definir_chave_pix_principal(uuid) from public, anon;
grant execute on function public.definir_chave_pix_principal(uuid) to authenticated;
