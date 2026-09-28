-- Fase 2: ciclo de vida transacional do bico (docs/JOB_LIFECYCLE_DESIGN.md).
--
-- Antes: o contratante concluía o bico sozinho, "em_andamento" queria dizer
-- "prestador escolhido", o status mudava por UPDATE direto e escolher_candidato
-- não travava nada. Agora:
--   aberto → atribuido → em_andamento → aguardando_confirmacao → concluido
--   (+ cancelado e em_disputa), cada passo por uma RPC que confere quem chama,
--   trava a linha do bico e grava tudo numa transação só.
--
-- Nenhuma função existente muda de tipo de retorno (evita o erro 42P13): todo
-- CREATE OR REPLACE abaixo mantém exatamente a assinatura e o retorno atuais.
-- Não mexe em bicos_proximos. Funciona com ou sem a 0018 aplicada.
--
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode. O editor
-- executa o arquivo como uma transação só: ou entra tudo, ou nada.

-- ============================================================================
-- 1) bicos: novos estados, carimbos de tempo e dados antigos normalizados
-- ============================================================================

-- Carimbados pelo trigger na entrada de cada estado; ninguém escreve direto.
alter table public.bicos
  add column atribuido_em timestamptz,
  add column iniciado_em timestamptz,
  add column finalizado_pelo_prestador_em timestamptz,
  add column concluido_em timestamptz;

-- O CHECK de status nasceu inline na 0001 (nome gerado pelo Postgres); é
-- localizado pela definição em vez de confiar no nome.
do $$
declare
  v_restricao record;
begin
  for v_restricao in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.bicos'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%em_andamento%'
  loop
    execute format('alter table public.bicos drop constraint %I', v_restricao.conname);
  end loop;
end
$$;

-- Normalização dos dados antigos. Os triggers ficam desligados só aqui dentro:
-- estas mudanças não são transições do usuário (e o atualizado_em original é
-- usado como melhor estimativa de quando cada coisa aconteceu).
alter table public.bicos disable trigger bicos_validar_transicao;
alter table public.bicos disable trigger bicos_set_atualizado_em;

-- Estados impossíveis que regras antigas deixavam passar por UPDATE direto.
update public.bicos set status = 'aberto'
where status = 'em_andamento' and candidato_selecionado_id is null;

-- "em_andamento" antigo significava "prestador escolhido" (a escolha já
-- mudava o status): no modelo novo isso é "atribuido". Idem para bico que
-- ficou "aberto" com prestador preenchido.
update public.bicos set status = 'atribuido', atribuido_em = atualizado_em
where status in ('em_andamento', 'aberto') and candidato_selecionado_id is not null;

update public.bicos set concluido_em = atualizado_em
where status = 'concluido' and concluido_em is null;

alter table public.bicos enable trigger bicos_set_atualizado_em;
alter table public.bicos enable trigger bicos_validar_transicao;

alter table public.bicos
  add constraint bicos_status_check check (status in (
    'aberto', 'atribuido', 'em_andamento', 'aguardando_confirmacao', 'concluido', 'cancelado', 'em_disputa'
  )),
  -- Prestador existe exatamente nos estados em que alguém foi escolhido
  -- (concluido/cancelado ficam livres por causa do histórico antigo).
  add constraint bicos_prestador_coerente check (
    (status = 'aberto' and candidato_selecionado_id is null)
    or (status in ('atribuido', 'em_andamento', 'aguardando_confirmacao', 'em_disputa') and candidato_selecionado_id is not null)
    or status in ('concluido', 'cancelado')
  ),
  add constraint bicos_concluido_com_data check (status <> 'concluido' or concluido_em is not null);

create index if not exists bicos_status_criado_em_idx on public.bicos (status, criado_em desc);
create index if not exists bicos_candidato_status_idx on public.bicos (candidato_selecionado_id, status);
create index if not exists bicos_criado_por_status_idx on public.bicos (criado_por, status);

-- ============================================================================
-- 2) candidaturas: dados coerentes e no máximo uma aceita por bico
-- ============================================================================

-- "aceita" que não corresponde ao prestador do bico (o dono podia trocar
-- status à vontade por UPDATE direto, auditoria M5).
update public.candidaturas c
set status = case when b.status = 'aberto' then 'pendente' else 'recusada' end
from public.bicos b
where b.id = c.bico_id
  and c.status = 'aceita'
  and b.candidato_selecionado_id is distinct from c.candidato_id;

-- Prestador escolhido por UPDATE direto ficou com candidatura "pendente".
update public.candidaturas c
set status = 'aceita'
from public.bicos b
where b.id = c.bico_id
  and b.status <> 'aberto'
  and b.candidato_selecionado_id = c.candidato_id
  and c.status = 'pendente';

-- Rede de segurança da concorrência: mesmo que duas aceitações escapassem da
-- trava da RPC, o banco não aceita duas candidaturas "aceita" no mesmo bico.
create unique index candidaturas_uma_aceita_por_bico on public.candidaturas (bico_id) where status = 'aceita';
create index if not exists candidaturas_candidato_idx on public.candidaturas (candidato_id);

-- NOT VALID: vale para o que entrar daqui pra frente sem reprovar linha antiga.
alter table public.candidaturas
  add constraint candidaturas_mensagem_tamanho check (mensagem is null or char_length(mensagem) <= 500) not valid;

-- ============================================================================
-- 3) avaliações cegas e reputação a partir de dados autoritativos
-- ============================================================================

-- Momento em que a avaliação ficou visível para os outros (as duas partes
-- avaliaram, ou o prazo acabou). As que já existiam eram públicas: continuam.
alter table public.avaliacoes add column revelada_em timestamptz;
update public.avaliacoes set revelada_em = criado_em where revelada_em is null;

create index if not exists avaliacoes_avaliado_idx on public.avaliacoes (avaliado_id);

-- total_bicos_como_* passa a contar bicos CONCLUÍDOS (era contagem de
-- avaliações com nome de bicos); a contagem de avaliações ganha coluna própria.
alter table public.profiles
  add column total_avaliacoes_como_prestador integer not null default 0,
  add column total_avaliacoes_como_contratante integer not null default 0;

grant select (total_avaliacoes_como_prestador, total_avaliacoes_como_contratante) on public.profiles to authenticated;

-- Fonte única do prazo de avaliação (policy, RPC e revelação usam esta).
create or replace function public.prazo_avaliacao()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '14 days';
$$;

revoke execute on function public.prazo_avaliacao() from public, anon;
grant execute on function public.prazo_avaliacao() to authenticated;

-- ============================================================================
-- 4) cancelamentos, disputas e notificações
-- ============================================================================

-- Quem cancelou e por quê. Tabela à parte (e não colunas em bicos) porque a
-- linha do bico é legível por qualquer conta; o motivo e o texto livre só
-- interessam aos dois participantes.
create table public.cancelamentos (
  bico_id uuid primary key references public.bicos (id) on delete cascade,
  cancelado_por uuid references public.profiles (id), -- null = encerrado pela moderação
  motivo text not null check (motivo in (
    'problema_de_agenda', 'desacordo_de_preco', 'prestador_indisponivel', 'contratante_indisponivel',
    'nao_compareceu', 'ambiente_inseguro', 'outro'
  )),
  detalhes text check (detalhes is null or char_length(detalhes) <= 500),
  criado_em timestamptz not null default now()
);

create table public.disputas (
  id uuid primary key default gen_random_uuid(),
  bico_id uuid not null references public.bicos (id) on delete cascade,
  aberta_por uuid not null references public.profiles (id),
  motivo text not null check (motivo in (
    'servico_nao_realizado', 'problema_de_pagamento', 'comportamento_inseguro',
    'servico_diferente_do_combinado', 'nao_compareceu', 'outro'
  )),
  descricao text not null check (char_length(descricao) between 10 and 2000),
  status text not null default 'aberta' check (status in ('aberta', 'em_analise', 'resolvida')),
  resultado text check (resultado in ('concluido', 'cancelado')),
  resolucao text check (resolucao is null or char_length(resolucao) <= 2000),
  resolvida_por uuid,
  resolvida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint disputas_resolucao_coerente check (
    (status = 'resolvida') = (resultado is not null and resolvida_em is not null)
  )
);

-- Uma disputa ativa por bico.
create unique index disputas_uma_ativa_por_bico on public.disputas (bico_id) where status <> 'resolvida';

-- Registro de notificações: a chave única é o que impede avisar duas vezes o
-- mesmo evento, e a tabela já serve de base para uma caixa de entrada no app.
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in (
    'candidatura_recebida', 'candidatura_aceita', 'candidatura_recusada',
    'bico_iniciado', 'bico_finalizado', 'bico_concluido', 'bico_cancelado',
    'disputa_aberta', 'disputa_resolvida', 'avaliacao_recebida'
  )),
  bico_id uuid references public.bicos (id) on delete cascade,
  chave text not null unique,
  titulo text not null,
  corpo text not null,
  criado_em timestamptz not null default now()
);

create index notificacoes_usuario_idx on public.notificacoes (usuario_id, criado_em desc);

alter table public.cancelamentos enable row level security;
alter table public.disputas enable row level security;
alter table public.notificacoes enable row level security;

create policy "Participantes veem o cancelamento do bico"
  on public.cancelamentos for select
  to authenticated
  using (
    exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and (select auth.uid()) in (b.criado_por, b.candidato_selecionado_id)
    )
  );

create policy "Participantes veem as disputas do bico"
  on public.disputas for select
  to authenticated
  using (
    exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and (select auth.uid()) in (b.criado_por, b.candidato_selecionado_id)
    )
  );

create policy "Usuário vê as próprias notificações"
  on public.notificacoes for select
  to authenticated
  using (usuario_id = (select auth.uid()));

-- Escrita só pelas RPCs (security definer). Acesso explícito: o anon não
-- enxerga nada e o authenticated só lê.
revoke all on public.cancelamentos, public.disputas, public.notificacoes from anon, authenticated;
grant select on public.cancelamentos, public.disputas, public.notificacoes to authenticated;

-- ============================================================================
-- 5) notificação: registra (sem duplicar) e dispara o push
-- ============================================================================

-- Chamada só de dentro das RPCs/triggers. Tudo num bloco de exceção: um
-- problema aqui vira WARNING no log e NUNCA desfaz a ação que notificou.
create or replace function public.notificar_evento(
  p_usuario_id uuid,
  p_tipo text,
  p_bico_id uuid,
  p_chave text,
  p_titulo text,
  p_corpo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_usuario_id is null then
    return;
  end if;

  begin
    insert into public.notificacoes (usuario_id, tipo, bico_id, chave, titulo, corpo)
    values (p_usuario_id, p_tipo, p_bico_id, p_chave, left(p_titulo, 120), left(p_corpo, 300))
    on conflict (chave) do nothing
    returning id into v_id;

    if v_id is not null then
      perform public.notificar_push(
        p_usuario_id,
        left(p_titulo, 120),
        left(p_corpo, 300),
        jsonb_build_object('tipo', p_tipo, 'bico_id', p_bico_id)
      );
    end if;
  exception when others then
    raise warning 'notificar_evento(%): % %', p_tipo, sqlstate, sqlerrm;
  end;
end;
$$;

revoke execute on function public.notificar_evento(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- ============================================================================
-- 6) triggers de bicos: nascimento, máquina de estados e carimbos
-- ============================================================================

-- Mesma regra da 0018 (bico nasce aberto e sem prestador), agora com código
-- de erro estável e também zerando os carimbos novos.
create or replace function public.validar_insercao_bico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from 'aberto' or new.candidato_selecionado_id is not null then
    raise exception 'Um bico novo sempre começa aberto, sem prestador escolhido.'
      using hint = 'JOB_MUST_START_OPEN';
  end if;

  new.criado_em := now();
  new.atualizado_em := now();
  new.atribuido_em := null;
  new.iniciado_em := null;
  new.finalizado_pelo_prestador_em := null;
  new.concluido_em := null;
  return new;
end;
$$;

drop trigger if exists bicos_validar_insercao on public.bicos;

create trigger bicos_validar_insercao
  before insert on public.bicos
  for each row execute function public.validar_insercao_bico();

-- Guarda final de qualquer UPDATE em bicos, venha de RPC, do painel ou de
-- service_role. As RPCs decidem QUEM pode; este trigger decide o que é
-- possível.
create or replace function public.validar_transicao_bico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.criado_por is distinct from old.criado_por or new.criado_em is distinct from old.criado_em then
    raise exception 'Autor e data de publicação do bico não podem ser alterados.'
      using hint = 'JOB_FIELDS_IMMUTABLE';
  end if;

  -- O que foi combinado congela quando alguém é escolhido: é o registro que
  -- uma disputa "serviço diferente do combinado" vai precisar.
  if old.status <> 'aberto' and (
       new.titulo is distinct from old.titulo
    or new.descricao is distinct from old.descricao
    or new.categoria_id is distinct from old.categoria_id
    or new.endereco_texto is distinct from old.endereco_texto
    or new.localizacao::text is distinct from old.localizacao::text
    or new.valor_oferecido is distinct from old.valor_oferecido
    or new.forma_pagamento is distinct from old.forma_pagamento
    or new.data_hora_desejada is distinct from old.data_hora_desejada
  ) then
    raise exception 'Depois que um prestador é escolhido, os dados do bico não podem mais ser alterados.'
      using hint = 'JOB_LOCKED';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'aberto' and new.status in ('atribuido', 'cancelado'))
    or (old.status = 'atribuido' and new.status in ('em_andamento', 'cancelado'))
    or (old.status = 'em_andamento' and new.status in ('aguardando_confirmacao', 'em_disputa', 'cancelado'))
    or (old.status = 'aguardando_confirmacao' and new.status in ('concluido', 'em_disputa'))
    or (old.status = 'em_disputa' and new.status in ('concluido', 'cancelado'))
  ) then
    raise exception 'Transição de status inválida: % -> %', old.status, new.status
      using hint = 'INVALID_JOB_TRANSITION';
  end if;

  -- O prestador só é definido uma vez, na passagem aberto → atribuido.
  if new.candidato_selecionado_id is distinct from old.candidato_selecionado_id
     and not (old.status = 'aberto' and new.status = 'atribuido' and old.candidato_selecionado_id is null) then
    raise exception 'O prestador escolhido não pode ser trocado.'
      using hint = 'JOB_ALREADY_ASSIGNED';
  end if;

  if old.status = 'aberto' and new.status = 'atribuido' then
    if new.candidato_selecionado_id is null then
      raise exception 'Escolha um candidato para atribuir o bico.'
        using hint = 'INVALID_JOB_TRANSITION';
    end if;

    if new.candidato_selecionado_id = new.criado_por then
      raise exception 'Você não pode ser o prestador do seu próprio bico.'
        using hint = 'CANNOT_SELECT_OWNER';
    end if;

    -- aceitar_candidatura marca "aceita" antes de atualizar o bico; por isso
    -- as duas situações valem. Quem retirou ou foi recusado, não.
    if not exists (
      select 1 from public.candidaturas c
      where c.bico_id = new.id
        and c.candidato_id = new.candidato_selecionado_id
        and c.status in ('pendente', 'aceita')
    ) then
      raise exception 'Só é possível escolher alguém com candidatura ativa neste bico.'
        using hint = 'APPLICATION_NOT_PENDING';
    end if;
  end if;

  -- Carimbos do servidor: entram na transição, e fora dela não mudam.
  new.atribuido_em := case when old.status = 'aberto' and new.status = 'atribuido' then now() else old.atribuido_em end;
  new.iniciado_em := case when old.status = 'atribuido' and new.status = 'em_andamento' then now() else old.iniciado_em end;
  new.finalizado_pelo_prestador_em := case
    when old.status = 'em_andamento' and new.status = 'aguardando_confirmacao' then now()
    else old.finalizado_pelo_prestador_em
  end;
  new.concluido_em := case when old.status <> 'concluido' and new.status = 'concluido' then now() else old.concluido_em end;

  return new;
end;
$$;

-- ============================================================================
-- 7) candidatura: regras no banco, inclusive na corrida com a aceitação
-- ============================================================================

-- SECURITY DEFINER só para conseguir travar a linha do bico (o candidato não
-- tem UPDATE nela). FOR SHARE espera um aceitar_candidatura em curso, que
-- segura FOR UPDATE, e relê o status depois: sem isso uma candidatura podia
-- entrar num bico que acabou de ser atribuído.
create or replace function public.validar_insercao_candidatura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_dono uuid;
begin
  select b.status, b.criado_por into v_status, v_dono
  from public.bicos b
  where b.id = new.bico_id
  for share;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_dono = new.candidato_id then
    raise exception 'Você não pode se candidatar ao seu próprio bico.' using hint = 'CANNOT_APPLY_OWN_JOB';
  end if;

  if v_status <> 'aberto' then
    raise exception 'Este bico não está mais recebendo candidaturas.' using hint = 'JOB_NOT_OPEN';
  end if;

  -- O cliente não escolhe o status nem a data da própria candidatura.
  new.status := 'pendente';
  new.criado_em := now();
  return new;
end;
$$;

revoke execute on function public.validar_insercao_candidatura() from public, anon, authenticated;

drop trigger if exists candidaturas_validar_insercao on public.candidaturas;

create trigger candidaturas_validar_insercao
  before insert on public.candidaturas
  for each row execute function public.validar_insercao_candidatura();

-- A policy repete o essencial (defesa em profundidade) e passa a recusar a
-- candidatura ao próprio bico.
drop policy if exists "Usuário autenticado pode se candidatar" on public.candidaturas;

create policy "Usuário autenticado pode se candidatar"
  on public.candidaturas for insert
  to authenticated
  with check (
    candidato_id = (select auth.uid())
    and status = 'pendente'
    and public.conta_ativa()
    and exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and b.status = 'aberto'
        and b.criado_por <> (select auth.uid())
    )
  );

-- Status de candidatura só muda pelas RPCs (aceitar/retirar). Revogar a
-- tabela também revoga o grant por coluna (status) dado na 0010.
drop policy if exists "Dono do bico aceita ou recusa candidatura" on public.candidaturas;
drop policy if exists "Candidato retira a propria candidatura" on public.candidaturas;
revoke update on public.candidaturas from authenticated;

-- Aviso ao dono, agora pelo registro sem duplicidade.
create or replace function public.candidaturas_notificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono uuid;
  v_titulo text;
  v_candidato text;
begin
  select b.criado_por, b.titulo into v_dono, v_titulo
  from public.bicos b
  where b.id = new.bico_id;

  select coalesce(p.nome_completo, 'Alguém') into v_candidato
  from public.profiles p
  where p.id = new.candidato_id;

  perform public.notificar_evento(
    v_dono,
    'candidatura_recebida',
    new.bico_id,
    'candidatura_recebida:' || new.id,
    'Nova candidatura',
    format('%s se candidatou a "%s".', v_candidato, v_titulo)
  );

  return new;
end;
$$;

-- ============================================================================
-- 8) RPCs do ciclo de vida
-- ============================================================================
-- Todas: auth.uid() obrigatório, conta ativa, linha do bico travada com
-- FOR UPDATE ANTES de ler o status (duas chamadas simultâneas viram fila e a
-- segunda enxerga o resultado da primeira), erro com mensagem em português e
-- código estável no HINT. Repetir a mesma ação (toque duplo, rede instável) é
-- inofensivo: se o bico já está no estado de destino, a RPC só retorna.

create or replace function public.candidatar_se(p_bico_id uuid, p_mensagem text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  -- security invoker: o insert passa pela RLS e pelo trigger como qualquer
  -- outro; o candidato é sempre quem chama, nunca um id vindo do app.
  insert into public.candidaturas (bico_id, candidato_id, mensagem)
  values (p_bico_id, auth.uid(), nullif(trim(p_mensagem), ''))
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Você já se candidatou a este bico.' using hint = 'APPLICATION_ALREADY_EXISTS';
end;
$$;

create or replace function public.aceitar_candidatura(p_candidatura_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico_id uuid;
  v_candidato uuid;
  v_status_candidatura text;
  v_bico record;
  v_outra record;
  v_nome_dono text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  select c.bico_id, c.candidato_id into v_bico_id, v_candidato
  from public.candidaturas c
  where c.id = p_candidatura_id;

  if not found then
    raise exception 'Candidatura não encontrada.' using hint = 'APPLICATION_NOT_FOUND';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = v_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_bico.criado_por <> v_usuario then
    raise exception 'Só quem publicou o bico pode escolher o prestador.' using hint = 'NOT_JOB_OWNER';
  end if;

  if v_bico.status <> 'aberto' then
    if v_bico.candidato_selecionado_id = v_candidato then
      return; -- mesma escolha repetida: já está feita
    end if;
    if v_bico.candidato_selecionado_id is not null then
      raise exception 'Este bico já tem um prestador escolhido.' using hint = 'JOB_ALREADY_ASSIGNED';
    end if;
    raise exception 'Este bico não está mais aberto.' using hint = 'JOB_NOT_OPEN';
  end if;

  -- Relida com o bico já travado: retirar_candidatura trava o mesmo bico,
  -- então o status aqui não muda até o fim desta transação.
  select c.status into v_status_candidatura
  from public.candidaturas c
  where c.id = p_candidatura_id
  for update;

  if v_status_candidatura <> 'pendente' then
    raise exception 'Esse candidato não está mais disponível para este bico.' using hint = 'APPLICATION_NOT_PENDING';
  end if;

  if v_candidato = v_usuario then
    raise exception 'Você não pode ser o prestador do seu próprio bico.' using hint = 'CANNOT_SELECT_OWNER';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_candidato and p.status_conta = 'ativo') then
    raise exception 'Esse candidato não está mais disponível.' using hint = 'APPLICANT_UNAVAILABLE';
  end if;

  update public.candidaturas set status = 'aceita' where id = p_candidatura_id;

  update public.bicos
  set status = 'atribuido', candidato_selecionado_id = v_candidato
  where id = v_bico.id;

  select coalesce(p.nome_completo, 'O contratante') into v_nome_dono
  from public.profiles p
  where p.id = v_usuario;

  perform public.notificar_evento(
    v_candidato,
    'candidatura_aceita',
    v_bico.id,
    'candidatura_aceita:' || p_candidatura_id,
    'Você foi escolhido!',
    format('%s escolheu você para "%s". Combine os detalhes pelo chat.', v_nome_dono, v_bico.titulo)
  );

  for v_outra in
    update public.candidaturas
    set status = 'recusada'
    where bico_id = v_bico.id and id <> p_candidatura_id and status = 'pendente'
    returning id, candidato_id
  loop
    perform public.notificar_evento(
      v_outra.candidato_id,
      'candidatura_recusada',
      v_bico.id,
      'candidatura_recusada:' || v_outra.id,
      'Candidatura não selecionada',
      format('O contratante escolheu outra pessoa para "%s".', v_bico.titulo)
    );
  end loop;
end;
$$;

create or replace function public.retirar_candidatura(p_candidatura_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico_id uuid;
  v_candidato uuid;
  v_status text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;

  select c.bico_id, c.candidato_id into v_bico_id, v_candidato
  from public.candidaturas c
  where c.id = p_candidatura_id;

  -- Mesmo erro para "não existe" e "não é sua": não confirma que existe.
  if not found or v_candidato <> v_usuario then
    raise exception 'Candidatura não encontrada.' using hint = 'APPLICATION_NOT_FOUND';
  end if;

  perform 1 from public.bicos b where b.id = v_bico_id for update;

  select c.status into v_status from public.candidaturas c where c.id = p_candidatura_id;

  if v_status = 'retirada' then
    return;
  end if;
  if v_status <> 'pendente' then
    raise exception 'Esta candidatura não pode mais ser retirada.' using hint = 'APPLICATION_NOT_PENDING';
  end if;

  update public.candidaturas set status = 'retirada' where id = p_candidatura_id;
end;
$$;

create or replace function public.iniciar_bico(p_bico_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico record;
  v_nome text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  -- Só o prestador inicia: é o "cheguei" dele no local. Enquanto não inicia,
  -- o contratante ainda pode cancelar por não comparecimento.
  if v_bico.candidato_selecionado_id is distinct from v_usuario then
    if v_bico.criado_por = v_usuario then
      raise exception 'Quem inicia o serviço é o prestador, ao chegar no local.' using hint = 'NOT_SELECTED_WORKER';
    end if;
    raise exception 'Você não participa deste bico.' using hint = 'NOT_JOB_PARTICIPANT';
  end if;

  if v_bico.status = 'em_andamento' then
    return;
  end if;
  if v_bico.status <> 'atribuido' then
    raise exception 'Este bico não está aguardando início.' using hint = 'JOB_NOT_ASSIGNED';
  end if;

  update public.bicos set status = 'em_andamento' where id = p_bico_id;

  select coalesce(p.nome_completo, 'O prestador') into v_nome from public.profiles p where p.id = v_usuario;

  perform public.notificar_evento(
    v_bico.criado_por,
    'bico_iniciado',
    p_bico_id,
    'bico_iniciado:' || p_bico_id,
    'Serviço iniciado',
    format('%s iniciou "%s".', v_nome, v_bico.titulo)
  );
end;
$$;

create or replace function public.marcar_bico_finalizado(p_bico_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico record;
  v_nome text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_bico.candidato_selecionado_id is distinct from v_usuario then
    if v_bico.criado_por = v_usuario then
      raise exception 'Quem marca o serviço como finalizado é o prestador.' using hint = 'NOT_SELECTED_WORKER';
    end if;
    raise exception 'Você não participa deste bico.' using hint = 'NOT_JOB_PARTICIPANT';
  end if;

  if v_bico.status = 'aguardando_confirmacao' then
    return;
  end if;
  if v_bico.status <> 'em_andamento' then
    raise exception 'O serviço precisa estar em andamento para ser finalizado.' using hint = 'JOB_NOT_IN_PROGRESS';
  end if;

  update public.bicos set status = 'aguardando_confirmacao' where id = p_bico_id;

  select coalesce(p.nome_completo, 'O prestador') into v_nome from public.profiles p where p.id = v_usuario;

  perform public.notificar_evento(
    v_bico.criado_por,
    'bico_finalizado',
    p_bico_id,
    'bico_finalizado:' || p_bico_id,
    'Serviço finalizado pelo prestador',
    format('%s marcou "%s" como finalizado. Confirme a conclusão no app.', v_nome, v_bico.titulo)
  );
end;
$$;

create or replace function public.confirmar_conclusao_bico(p_bico_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico record;
  v_nome text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_bico.criado_por <> v_usuario then
    raise exception 'Só o contratante confirma a conclusão do serviço.' using hint = 'NOT_JOB_OWNER';
  end if;

  if v_bico.status = 'concluido' then
    return;
  end if;
  if v_bico.status <> 'aguardando_confirmacao' then
    raise exception 'O prestador ainda não marcou o serviço como finalizado.' using hint = 'JOB_NOT_AWAITING_CONFIRMATION';
  end if;

  update public.bicos set status = 'concluido' where id = p_bico_id;

  select coalesce(p.nome_completo, 'O contratante') into v_nome from public.profiles p where p.id = v_usuario;

  perform public.notificar_evento(
    v_bico.candidato_selecionado_id,
    'bico_concluido',
    p_bico_id,
    'bico_concluido:' || p_bico_id,
    'Serviço concluído',
    format('%s confirmou a conclusão de "%s". Avalie como foi.', v_nome, v_bico.titulo)
  );
end;
$$;

-- Quem pode cancelar em cada estágio (docs/JOB_LIFECYCLE_DESIGN.md, B5):
--   aberto: dono · atribuido: dono ou prestador · em_andamento: só o
--   prestador (o dono abre disputa) · daí em diante: ninguém.
create or replace function public.cancelar_bico(p_bico_id uuid, p_motivo text, p_detalhes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_detalhes text := left(nullif(trim(p_detalhes), ''), 500);
  v_bico record;
  v_eh_dono boolean;
  v_eh_prestador boolean;
  v_nome text;
  v_candidato uuid;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  if p_motivo is null or p_motivo not in (
    'problema_de_agenda', 'desacordo_de_preco', 'prestador_indisponivel', 'contratante_indisponivel',
    'nao_compareceu', 'ambiente_inseguro', 'outro'
  ) then
    raise exception 'Escolha um motivo válido para o cancelamento.' using hint = 'INVALID_CANCELLATION_REASON';
  end if;

  if p_motivo = 'outro' and coalesce(char_length(v_detalhes), 0) < 5 then
    raise exception 'Conte em poucas palavras por que está cancelando.' using hint = 'CANCELLATION_DETAILS_REQUIRED';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  v_eh_dono := v_bico.criado_por = v_usuario;
  v_eh_prestador := v_bico.candidato_selecionado_id is not null and v_bico.candidato_selecionado_id = v_usuario;

  if not (v_eh_dono or v_eh_prestador) then
    raise exception 'Você não participa deste bico.' using hint = 'NOT_JOB_PARTICIPANT';
  end if;

  if v_bico.status = 'cancelado' then
    return;
  end if;

  if v_bico.status = 'em_andamento' and v_eh_dono then
    raise exception 'Com o serviço em andamento, o contratante não cancela sozinho: abra uma disputa.'
      using hint = 'CANCELLATION_NOT_ALLOWED';
  end if;

  if v_bico.status = 'aguardando_confirmacao' then
    raise exception 'O serviço já foi marcado como finalizado: confirme a conclusão ou abra uma disputa.'
      using hint = 'CANCELLATION_NOT_ALLOWED';
  end if;

  if not (
       (v_bico.status = 'aberto' and v_eh_dono)
    or v_bico.status = 'atribuido'
    or (v_bico.status = 'em_andamento' and v_eh_prestador)
  ) then
    raise exception 'Este bico não pode mais ser cancelado.' using hint = 'CANCELLATION_NOT_ALLOWED';
  end if;

  update public.bicos set status = 'cancelado' where id = p_bico_id;

  insert into public.cancelamentos (bico_id, cancelado_por, motivo, detalhes)
  values (p_bico_id, v_usuario, p_motivo, v_detalhes);

  select coalesce(p.nome_completo, 'A outra parte') into v_nome from public.profiles p where p.id = v_usuario;

  if v_bico.candidato_selecionado_id is not null then
    perform public.notificar_evento(
      case when v_eh_dono then v_bico.candidato_selecionado_id else v_bico.criado_por end,
      'bico_cancelado',
      p_bico_id,
      'bico_cancelado:' || p_bico_id,
      'Bico cancelado',
      format('%s cancelou "%s".', v_nome, v_bico.titulo)
    );
  else
    -- Ainda aberto: quem estava esperando resposta fica sabendo.
    for v_candidato in
      select c.candidato_id from public.candidaturas c
      where c.bico_id = p_bico_id and c.status = 'pendente'
    loop
      perform public.notificar_evento(
        v_candidato,
        'bico_cancelado',
        p_bico_id,
        'bico_cancelado:' || p_bico_id || ':' || v_candidato,
        'Bico cancelado',
        format('O bico "%s" foi cancelado pelo contratante.', v_bico.titulo)
      );
    end loop;
  end if;
end;
$$;

create or replace function public.abrir_disputa(p_bico_id uuid, p_motivo text, p_descricao text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_descricao text := nullif(trim(p_descricao), '');
  v_bico record;
  v_id uuid;
  v_nome text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  if p_motivo is null or p_motivo not in (
    'servico_nao_realizado', 'problema_de_pagamento', 'comportamento_inseguro',
    'servico_diferente_do_combinado', 'nao_compareceu', 'outro'
  ) then
    raise exception 'Escolha um motivo válido para a disputa.' using hint = 'INVALID_DISPUTE_REASON';
  end if;

  if coalesce(char_length(v_descricao), 0) < 10 then
    raise exception 'Descreva o problema com pelo menos 10 caracteres.' using hint = 'DISPUTE_DESCRIPTION_REQUIRED';
  end if;

  select b.id, b.titulo, b.status, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_usuario is distinct from v_bico.criado_por and v_usuario is distinct from v_bico.candidato_selecionado_id then
    raise exception 'Só quem participa do bico pode abrir uma disputa.' using hint = 'NOT_JOB_PARTICIPANT';
  end if;

  if v_bico.status = 'em_disputa' then
    raise exception 'Já existe uma disputa aberta para este bico.' using hint = 'DISPUTE_ALREADY_OPEN';
  end if;

  if v_bico.status not in ('em_andamento', 'aguardando_confirmacao') then
    raise exception 'Só dá para abrir disputa com o serviço em andamento ou aguardando confirmação.'
      using hint = 'DISPUTE_NOT_ALLOWED';
  end if;

  insert into public.disputas (bico_id, aberta_por, motivo, descricao)
  values (p_bico_id, v_usuario, p_motivo, left(v_descricao, 2000))
  returning id into v_id;

  update public.bicos set status = 'em_disputa' where id = p_bico_id;

  select coalesce(p.nome_completo, 'A outra parte') into v_nome from public.profiles p where p.id = v_usuario;

  perform public.notificar_evento(
    case when v_usuario = v_bico.criado_por then v_bico.candidato_selecionado_id else v_bico.criado_por end,
    'disputa_aberta',
    p_bico_id,
    'disputa_aberta:' || v_id,
    'Disputa aberta',
    format('%s abriu uma disputa sobre "%s". A equipe do Estou Dentro vai analisar.', v_nome, v_bico.titulo)
  );

  return v_id;
end;
$$;

-- Moderação: não é executável pelo app (só service_role), fica pronta para
-- uma ferramenta de moderação futura. Encerra a disputa decidindo o destino
-- do bico: concluído (libera avaliações) ou cancelado.
create or replace function public.resolver_disputa(p_disputa_id uuid, p_resultado text, p_resolucao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolucao text := nullif(trim(p_resolucao), '');
  v_disputa record;
  v_bico record;
  v_participante uuid;
begin
  if p_resultado is null or p_resultado not in ('concluido', 'cancelado') then
    raise exception 'O resultado deve ser "concluido" ou "cancelado".' using hint = 'INVALID_JOB_TRANSITION';
  end if;
  if v_resolucao is null then
    raise exception 'Descreva a decisão tomada.' using hint = 'DISPUTE_DESCRIPTION_REQUIRED';
  end if;

  select d.id, d.bico_id, d.status into v_disputa
  from public.disputas d
  where d.id = p_disputa_id
  for update;

  if not found then
    raise exception 'Disputa não encontrada.' using hint = 'DISPUTE_NOT_FOUND';
  end if;
  if v_disputa.status = 'resolvida' then
    raise exception 'Esta disputa já foi resolvida.' using hint = 'DISPUTE_ALREADY_RESOLVED';
  end if;

  select b.id, b.titulo, b.criado_por, b.candidato_selecionado_id into v_bico
  from public.bicos b
  where b.id = v_disputa.bico_id
  for update;

  update public.bicos set status = p_resultado where id = v_bico.id;

  if p_resultado = 'cancelado' then
    insert into public.cancelamentos (bico_id, cancelado_por, motivo, detalhes)
    values (v_bico.id, null, 'outro', left(v_resolucao, 500));
  end if;

  update public.disputas
  set status = 'resolvida',
      resultado = p_resultado,
      resolucao = left(v_resolucao, 2000),
      resolvida_por = auth.uid(),
      resolvida_em = now(),
      atualizado_em = now()
  where id = p_disputa_id;

  foreach v_participante in array array[v_bico.criado_por, v_bico.candidato_selecionado_id]
  loop
    perform public.notificar_evento(
      v_participante,
      'disputa_resolvida',
      v_bico.id,
      'disputa_resolvida:' || p_disputa_id || ':' || v_participante,
      'Disputa encerrada',
      format('A disputa sobre "%s" foi encerrada pela equipe do Estou Dentro.', v_bico.titulo)
    );
  end loop;
end;
$$;

-- Avaliação com identidades derivadas de auth.uid(): o app só manda o bico,
-- a nota e o comentário. O bico fica travado para que duas avaliações
-- simultâneas se enxerguem e sejam reveladas juntas.
create or replace function public.avaliar_bico(p_bico_id uuid, p_nota integer, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_bico record;
  v_avaliado uuid;
  v_papel text;
begin
  if v_usuario is null then
    raise exception 'Faça login novamente.' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not public.conta_ativa() then
    raise exception 'Sua conta está suspensa.' using hint = 'ACCOUNT_SUSPENDED';
  end if;

  if p_nota is null or p_nota not between 1 and 5 then
    raise exception 'A nota deve ser de 1 a 5 estrelas.' using hint = 'INVALID_RATING';
  end if;

  select b.id, b.status, b.criado_por, b.candidato_selecionado_id, b.concluido_em into v_bico
  from public.bicos b
  where b.id = p_bico_id
  for update;

  if not found then
    raise exception 'Este bico não existe mais.' using hint = 'JOB_NOT_FOUND';
  end if;

  if v_usuario = v_bico.criado_por then
    v_avaliado := v_bico.candidato_selecionado_id;
    v_papel := 'prestador';
  elsif v_usuario = v_bico.candidato_selecionado_id then
    v_avaliado := v_bico.criado_por;
    v_papel := 'contratante';
  else
    raise exception 'Só quem participou do bico pode avaliar.' using hint = 'REVIEW_NOT_ALLOWED';
  end if;

  if v_bico.status <> 'concluido' or v_avaliado is null or v_avaliado = v_usuario then
    raise exception 'Só dá para avaliar depois que o bico for concluído.' using hint = 'REVIEW_NOT_ALLOWED';
  end if;

  if v_bico.concluido_em is null or v_bico.concluido_em + public.prazo_avaliacao() < now() then
    raise exception 'O prazo para avaliar este bico já terminou.' using hint = 'REVIEW_WINDOW_CLOSED';
  end if;

  begin
    insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota, comentario)
    values (p_bico_id, v_usuario, v_avaliado, v_papel, p_nota, left(nullif(trim(p_comentario), ''), 1000));
  exception when unique_violation then
    raise exception 'Você já avaliou este bico.' using hint = 'REVIEW_ALREADY_EXISTS';
  end;
end;
$$;

-- ============================================================================
-- 9) compatibilidade com builds antigos do app
-- ============================================================================
-- Mesmas assinaturas e mesmo retorno (void) da 0015/0011: CREATE OR REPLACE
-- seguro. Viram atalhos para as RPCs novas.

create or replace function public.escolher_candidato(p_bico_id uuid, p_candidato_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidatura uuid;
begin
  select c.id into v_candidatura
  from public.candidaturas c
  where c.bico_id = p_bico_id and c.candidato_id = p_candidato_id;

  if v_candidatura is null then
    raise exception 'Esse candidato não está mais disponível para este bico.' using hint = 'APPLICATION_NOT_FOUND';
  end if;

  perform public.aceitar_candidatura(v_candidatura);
end;
$$;

-- Antes concluía direto de "em_andamento"; agora só confirma o que o
-- prestador já marcou como finalizado, e avalia na mesma transação.
create or replace function public.fechar_bico_e_avaliar(
  p_bico_id uuid,
  p_nota integer,
  p_comentario text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.confirmar_conclusao_bico(p_bico_id);
  perform public.avaliar_bico(p_bico_id, p_nota, p_comentario);
end;
$$;

-- ============================================================================
-- 10) avaliações: revelação e reputação
-- ============================================================================

-- Depois de cada avaliação: se a outra parte já tinha avaliado, as duas ficam
-- visíveis agora. Avisa quem foi avaliado sem contar a nota.
create or replace function public.avaliacoes_revelar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulo text;
  v_revelou boolean;
begin
  update public.avaliacoes a
  set revelada_em = now()
  where a.bico_id = new.bico_id
    and a.revelada_em is null
    and exists (
      select 1 from public.avaliacoes o
      where o.bico_id = new.bico_id
        and o.avaliador_id = new.avaliado_id
        and o.avaliado_id = new.avaliador_id
    );
  v_revelou := found;

  select b.titulo into v_titulo from public.bicos b where b.id = new.bico_id;

  perform public.notificar_evento(
    new.avaliado_id,
    'avaliacao_recebida',
    new.bico_id,
    'avaliacao_recebida:' || new.id,
    'Você recebeu uma avaliação',
    case
      when v_revelou then format('As avaliações de "%s" já estão visíveis.', v_titulo)
      else format('Você foi avaliado em "%s". Avalie também para ver a nota (ou ela aparece em 14 dias).', v_titulo)
    end
  );

  return null;
end;
$$;

revoke execute on function public.avaliacoes_revelar() from public, anon, authenticated;

drop trigger if exists avaliacoes_revelar on public.avaliacoes;

create trigger avaliacoes_revelar
  after insert on public.avaliacoes
  for each row execute function public.avaliacoes_revelar();

-- Autoavaliação já é impossível por construção (avaliar_bico deriva quem é
-- avaliado), mas fica também como regra da tabela. NOT VALID: não reprova
-- linha antiga — a policy da 0001 ainda não barrava esse caso.
alter table public.avaliacoes
  add constraint avaliacoes_sem_autoavaliacao check (avaliador_id <> avaliado_id) not valid;

-- Avaliação é registro: depois de gravada, só revelada_em muda (pela
-- revelação). Vale até para service_role; moderação remove com DELETE, que
-- recalcula a reputação.
create or replace function public.avaliacoes_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bico_id is distinct from old.bico_id
     or new.avaliador_id is distinct from old.avaliador_id
     or new.avaliado_id is distinct from old.avaliado_id
     or new.papel_avaliado is distinct from old.papel_avaliado
     or new.nota is distinct from old.nota
     or new.comentario is distinct from old.comentario
     or new.criado_em is distinct from old.criado_em then
    raise exception 'Avaliações não podem ser alteradas depois de enviadas.' using hint = 'REVIEW_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists avaliacoes_imutavel on public.avaliacoes;

create trigger avaliacoes_imutavel
  before update on public.avaliacoes
  for each row execute function public.avaliacoes_imutavel();

-- Reputação só com o que já é público (revelada ou fora do prazo): somar uma
-- nota escondida à média deixaria a pessoa deduzi-la pela variação.
-- Mesma assinatura e retorno da 0014.
create or replace function public.recalcular_reputacao(p_usuario_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
  set nota_media_como_prestador = r.media_prestador,
      total_avaliacoes_como_prestador = r.total_prestador,
      nota_media_como_contratante = r.media_contratante,
      total_avaliacoes_como_contratante = r.total_contratante,
      total_bicos_como_prestador = (
        select count(*) from public.bicos b
        where b.candidato_selecionado_id = p_usuario_id
          and b.criado_por <> p_usuario_id
          and b.status = 'concluido'
      ),
      total_bicos_como_contratante = (
        select count(*) from public.bicos b
        where b.criado_por = p_usuario_id
          and b.candidato_selecionado_id is not null
          and b.candidato_selecionado_id <> p_usuario_id
          and b.status = 'concluido'
      )
  from (
    select
      round(avg(a.nota) filter (where a.papel_avaliado = 'prestador'), 2) as media_prestador,
      count(*) filter (where a.papel_avaliado = 'prestador') as total_prestador,
      round(avg(a.nota) filter (where a.papel_avaliado = 'contratante'), 2) as media_contratante,
      count(*) filter (where a.papel_avaliado = 'contratante') as total_contratante
    from public.avaliacoes a
    join public.bicos b on b.id = a.bico_id
    where a.avaliado_id = p_usuario_id
      and (a.revelada_em is not null or b.concluido_em + public.prazo_avaliacao() < now())
  ) r
  where p.id = p_usuario_id;
$$;

revoke execute on function public.recalcular_reputacao(uuid) from public, anon, authenticated;

create or replace function public.avaliacoes_recalcular_reputacao()
returns trigger
language plpgsql
security definer
set search_path = ''
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

-- Agora também quando uma avaliação é revelada.
drop trigger if exists avaliacoes_recalcular_reputacao on public.avaliacoes;

create trigger avaliacoes_recalcular_reputacao
  after insert or delete or update of revelada_em on public.avaliacoes
  for each row execute function public.avaliacoes_recalcular_reputacao();

-- Bicos concluídos contam na reputação dos dois participantes.
create or replace function public.bicos_recalcular_reputacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and (new.status = 'concluido' or old.status = 'concluido') then
    perform public.recalcular_reputacao(new.criado_por);
    if new.candidato_selecionado_id is not null then
      perform public.recalcular_reputacao(new.candidato_selecionado_id);
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.bicos_recalcular_reputacao() from public, anon, authenticated;

drop trigger if exists bicos_recalcular_reputacao on public.bicos;

create trigger bicos_recalcular_reputacao
  after update of status on public.bicos
  for each row execute function public.bicos_recalcular_reputacao();

-- Revela as avaliações cujo prazo acabou (a visibilidade já é calculada na
-- hora pela policy; isto atualiza revelada_em e, com ela, a reputação).
-- Agende de hora em hora com pg_cron — passo manual, ver o documento.
create or replace function public.revelar_avaliacoes_vencidas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  update public.avaliacoes a
  set revelada_em = now()
  from public.bicos b
  where b.id = a.bico_id
    and a.revelada_em is null
    and b.concluido_em + public.prazo_avaliacao() < now();

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- ============================================================================
-- 11) permissões
-- ============================================================================

-- bicos: status, prestador e carimbos só mudam pelas RPCs. O dono continua
-- editando a descrição enquanto o bico está aberto (o trigger congela depois).
revoke update on public.bicos from authenticated;
grant update (
  titulo, descricao, categoria_id, endereco_texto, localizacao,
  valor_oferecido, forma_pagamento, data_hora_desejada
) on public.bicos to authenticated;

grant select (atribuido_em, iniciado_em, finalizado_pelo_prestador_em, concluido_em) on public.bicos to authenticated;

-- avaliacoes: escrita só por avaliar_bico; leitura segue a regra cega.
drop policy if exists "Só quem participou do bico concluído pode avaliar" on public.avaliacoes;
revoke insert, update, delete on public.avaliacoes from anon, authenticated;

drop policy if exists "Avaliações são visíveis para usuários autenticados" on public.avaliacoes;

create policy "Avaliação visível depois de revelada"
  on public.avaliacoes for select
  to authenticated
  using (
    avaliador_id = (select auth.uid())
    or revelada_em is not null
    or exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and b.concluido_em + public.prazo_avaliacao() < now()
    )
  );

-- RPCs do app: só authenticated.
revoke execute on function public.candidatar_se(uuid, text) from public, anon;
revoke execute on function public.aceitar_candidatura(uuid) from public, anon;
revoke execute on function public.retirar_candidatura(uuid) from public, anon;
revoke execute on function public.iniciar_bico(uuid) from public, anon;
revoke execute on function public.marcar_bico_finalizado(uuid) from public, anon;
revoke execute on function public.confirmar_conclusao_bico(uuid) from public, anon;
revoke execute on function public.cancelar_bico(uuid, text, text) from public, anon;
revoke execute on function public.abrir_disputa(uuid, text, text) from public, anon;
revoke execute on function public.avaliar_bico(uuid, integer, text) from public, anon;
revoke execute on function public.escolher_candidato(uuid, uuid) from public, anon;
revoke execute on function public.fechar_bico_e_avaliar(uuid, integer, text) from public, anon;

grant execute on function public.candidatar_se(uuid, text) to authenticated;
grant execute on function public.aceitar_candidatura(uuid) to authenticated;
grant execute on function public.retirar_candidatura(uuid) to authenticated;
grant execute on function public.iniciar_bico(uuid) to authenticated;
grant execute on function public.marcar_bico_finalizado(uuid) to authenticated;
grant execute on function public.confirmar_conclusao_bico(uuid) to authenticated;
grant execute on function public.cancelar_bico(uuid, text, text) to authenticated;
grant execute on function public.abrir_disputa(uuid, text, text) to authenticated;
grant execute on function public.avaliar_bico(uuid, integer, text) to authenticated;
grant execute on function public.escolher_candidato(uuid, uuid) to authenticated;
grant execute on function public.fechar_bico_e_avaliar(uuid, integer, text) to authenticated;

-- Moderação e manutenção: nunca pelo app.
revoke execute on function public.resolver_disputa(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.revelar_avaliacoes_vencidas() from public, anon, authenticated;
grant execute on function public.resolver_disputa(uuid, text, text) to service_role;
grant execute on function public.revelar_avaliacoes_vencidas() to service_role;

-- ============================================================================
-- 12) reputação recalculada para todo mundo com as regras novas
-- ============================================================================
select public.recalcular_reputacao(p.id) from public.profiles p;
