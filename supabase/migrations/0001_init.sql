-- Estou Dentro — schema inicial
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

create extension if not exists postgis with schema extensions;

-- ========== profiles ==========
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome_completo text,
  foto_url text,
  biografia text,
  telefone text,
  telefone_verificado boolean not null default false,
  localizacao_atual extensions.geography(point, 4326),
  nota_media_como_prestador numeric(3, 2),
  nota_media_como_contratante numeric(3, 2),
  total_bicos_como_prestador integer not null default 0,
  total_bicos_como_contratante integer not null default 0,
  status_conta text not null default 'ativo' check (status_conta in ('ativo', 'suspenso', 'banido')),
  criado_em timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Perfis são visíveis para usuários autenticados"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Usuário só edita o próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Cria automaticamente uma linha em profiles quando um usuário se cadastra
-- (telefone vem de options.data.telefone passado no supabase.auth.signUp)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, telefone)
  values (new.id, new.raw_user_meta_data ->> 'telefone');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== categorias ==========
create table public.categorias (
  id serial primary key,
  nome text not null unique,
  icone text
);

alter table public.categorias enable row level security;

create policy "Categorias são visíveis para usuários autenticados"
  on public.categorias for select
  to authenticated
  using (true);

insert into public.categorias (nome, icone) values
  ('Pedreiro/Servente', 'hammer'),
  ('Garçom', 'utensils'),
  ('Faxina', 'spray-can'),
  ('Frete/Carreto', 'truck'),
  ('Outros', 'briefcase');

-- ========== bicos ==========
create table public.bicos (
  id uuid primary key default gen_random_uuid(),
  criado_por uuid not null references public.profiles (id) on delete cascade,
  categoria_id integer references public.categorias (id),
  titulo text not null,
  descricao text,
  localizacao extensions.geography(point, 4326),
  endereco_texto text,
  valor_oferecido numeric(10, 2),
  data_hora_desejada timestamptz,
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'concluido', 'cancelado')),
  candidato_selecionado_id uuid references public.profiles (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.bicos enable row level security;

create policy "Bicos são visíveis para usuários autenticados"
  on public.bicos for select
  to authenticated
  using (true);

create policy "Usuário autenticado pode criar bico"
  on public.bicos for insert
  to authenticated
  with check (auth.uid() = criado_por);

create policy "Só quem criou o bico pode editá-lo"
  on public.bicos for update
  to authenticated
  using (auth.uid() = criado_por);

create function public.set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger bicos_set_atualizado_em
  before update on public.bicos
  for each row execute function public.set_atualizado_em();

-- ========== candidaturas ==========
create table public.candidaturas (
  id uuid primary key default gen_random_uuid(),
  bico_id uuid not null references public.bicos (id) on delete cascade,
  candidato_id uuid not null references public.profiles (id) on delete cascade,
  mensagem text,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'recusada', 'retirada')),
  criado_em timestamptz not null default now(),
  unique (bico_id, candidato_id)
);

alter table public.candidaturas enable row level security;

create policy "Candidato e dono do bico veem a candidatura"
  on public.candidaturas for select
  to authenticated
  using (
    auth.uid() = candidato_id
    or exists (select 1 from public.bicos b where b.id = bico_id and b.criado_por = auth.uid())
  );

create policy "Usuário autenticado pode se candidatar"
  on public.candidaturas for insert
  to authenticated
  with check (auth.uid() = candidato_id);

create policy "Candidato ou dono do bico podem atualizar a candidatura"
  on public.candidaturas for update
  to authenticated
  using (
    auth.uid() = candidato_id
    or exists (select 1 from public.bicos b where b.id = bico_id and b.criado_por = auth.uid())
  );

-- ========== conversas e mensagens ==========
create table public.conversas (
  id uuid primary key default gen_random_uuid(),
  bico_id uuid not null references public.bicos (id) on delete cascade,
  participante_1_id uuid not null references public.profiles (id),
  participante_2_id uuid not null references public.profiles (id),
  criado_em timestamptz not null default now()
);

alter table public.conversas enable row level security;

create policy "Participantes veem a própria conversa"
  on public.conversas for select
  to authenticated
  using (auth.uid() = participante_1_id or auth.uid() = participante_2_id);

create policy "Participante pode criar conversa"
  on public.conversas for insert
  to authenticated
  with check (auth.uid() = participante_1_id or auth.uid() = participante_2_id);

create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas (id) on delete cascade,
  remetente_id uuid not null references public.profiles (id),
  conteudo text not null,
  enviado_em timestamptz not null default now(),
  lido_em timestamptz
);

alter table public.mensagens enable row level security;

create policy "Participantes da conversa veem as mensagens"
  on public.mensagens for select
  to authenticated
  using (
    exists (
      select 1 from public.conversas c
      where c.id = conversa_id
        and (c.participante_1_id = auth.uid() or c.participante_2_id = auth.uid())
    )
  );

create policy "Participante da conversa pode enviar mensagem"
  on public.mensagens for insert
  to authenticated
  with check (
    auth.uid() = remetente_id
    and exists (
      select 1 from public.conversas c
      where c.id = conversa_id
        and (c.participante_1_id = auth.uid() or c.participante_2_id = auth.uid())
    )
  );

-- ========== avaliacoes ==========
create table public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  bico_id uuid not null references public.bicos (id) on delete cascade,
  avaliador_id uuid not null references public.profiles (id),
  avaliado_id uuid not null references public.profiles (id),
  papel_avaliado text not null check (papel_avaliado in ('prestador', 'contratante')),
  nota integer not null check (nota between 1 and 5),
  comentario text,
  criado_em timestamptz not null default now(),
  unique (bico_id, avaliador_id, avaliado_id)
);

alter table public.avaliacoes enable row level security;

create policy "Avaliações são visíveis para usuários autenticados"
  on public.avaliacoes for select
  to authenticated
  using (true);

create policy "Só quem participou do bico concluído pode avaliar"
  on public.avaliacoes for insert
  to authenticated
  with check (
    auth.uid() = avaliador_id
    and exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and b.status = 'concluido'
        and (b.criado_por = auth.uid() or b.candidato_selecionado_id = auth.uid())
    )
  );

-- ========== comprovantes_pagamento ==========
create table public.comprovantes_pagamento (
  id uuid primary key default gen_random_uuid(),
  bico_id uuid not null references public.bicos (id) on delete cascade,
  anexado_por uuid not null references public.profiles (id),
  arquivo_url text not null,
  observacao text,
  criado_em timestamptz not null default now()
);

alter table public.comprovantes_pagamento enable row level security;

create policy "Participantes do bico veem o comprovante"
  on public.comprovantes_pagamento for select
  to authenticated
  using (
    exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and (b.criado_por = auth.uid() or b.candidato_selecionado_id = auth.uid())
    )
  );

create policy "Participante do bico pode anexar comprovante"
  on public.comprovantes_pagamento for insert
  to authenticated
  with check (
    auth.uid() = anexado_por
    and exists (
      select 1 from public.bicos b
      where b.id = bico_id
        and (b.criado_por = auth.uid() or b.candidato_selecionado_id = auth.uid())
    )
  );

-- ========== denuncias ==========
create table public.denuncias (
  id uuid primary key default gen_random_uuid(),
  denunciante_id uuid not null references public.profiles (id),
  denunciado_id uuid not null references public.profiles (id),
  bico_id uuid references public.bicos (id),
  motivo text not null check (motivo in ('golpe', 'calote', 'conteudo_inadequado', 'outro')),
  descricao text,
  status text not null default 'aberta' check (status in ('aberta', 'em_analise', 'resolvida')),
  criado_em timestamptz not null default now()
);

alter table public.denuncias enable row level security;

create policy "Denunciante vê as próprias denúncias"
  on public.denuncias for select
  to authenticated
  using (auth.uid() = denunciante_id);

create policy "Usuário autenticado pode denunciar"
  on public.denuncias for insert
  to authenticated
  with check (auth.uid() = denunciante_id);

-- ========== busca por proximidade ==========
-- Retorna bicos abertos num raio (em metros) a partir de um ponto, ordenados por distância.
create function public.bicos_proximos(lat double precision, lng double precision, raio_metros integer default 10000)
returns setof public.bicos
language sql
stable
as $$
  select b.*
  from public.bicos b
  where b.status = 'aberto'
    and b.localizacao is not null
    and extensions.ST_DWithin(
      b.localizacao,
      extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography,
      raio_metros
    )
  order by extensions.ST_Distance(
    b.localizacao,
    extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography
  );
$$;
