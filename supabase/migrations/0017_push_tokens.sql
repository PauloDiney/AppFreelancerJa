-- Notificações push: guarda o token de cada aparelho e dispara a Edge Function
-- "enviar-push" quando chega mensagem nova ou candidatura nova.
--
-- ANTES DE RODAR, defina os dois secrets abaixo no seu projeto (Database >
-- Settings, ou via SQL como superuser). Sem eles os triggers não têm pra onde
-- chamar e simplesmente não enviam nada — o insert continua funcionando:
--   alter database postgres set "app.settings.supabase_url" = 'https://SEU-REF.supabase.co';
--   alter database postgres set "app.settings.service_role_key" = 'SUA_SERVICE_ROLE_KEY';
--
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

-- ========== tabela de tokens ==========
-- Um usuário pode ter vários aparelhos, então a chave natural é o token (e não
-- o usuário): se a mesma pessoa reinstalar o app o Expo devolve um token novo,
-- e se outra conta logar no mesmo aparelho o token muda de dono — por isso o
-- unique é no token, com upsert do usuario_id.
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index push_tokens_usuario_id_idx on public.push_tokens (usuario_id);

alter table public.push_tokens enable row level security;

create policy "Usuário vê os próprios tokens"
  on public.push_tokens for select
  to authenticated
  using (auth.uid() = usuario_id);

create policy "Usuário registra o próprio token"
  on public.push_tokens for insert
  to authenticated
  with check (auth.uid() = usuario_id);

create policy "Usuário atualiza o próprio token"
  on public.push_tokens for update
  to authenticated
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

create policy "Usuário remove o próprio token"
  on public.push_tokens for delete
  to authenticated
  using (auth.uid() = usuario_id);

-- Mesma trava de coluna do resto do schema (0010/0014): nada além do token e do
-- dono deve ser reescrito pelo cliente.
revoke update on public.push_tokens from authenticated;
grant update (token, usuario_id, atualizado_em) on public.push_tokens to authenticated;

-- ========== disparo ==========
-- Chama a Edge Function por pg_net (assíncrono: se o push falhar ou demorar, a
-- mensagem já foi gravada do mesmo jeito — notificação nunca pode derrubar o
-- insert que a originou).
create extension if not exists pg_net with schema extensions;

create or replace function public.notificar_push(p_usuario_id uuid, p_titulo text, p_corpo text, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := current_setting('app.settings.supabase_url', true);
  v_key text := current_setting('app.settings.service_role_key', true);
begin
  if v_url is null or v_key is null then
    return; -- secrets não configurados: segue sem notificar
  end if;

  perform extensions.net_http_post(
    url := v_url || '/functions/v1/enviar-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'usuario_id', p_usuario_id,
      'titulo', p_titulo,
      'corpo', p_corpo,
      'dados', p_dados
    )
  );
end;
$$;

revoke execute on function public.notificar_push(uuid, text, text, jsonb) from public, anon, authenticated;

-- ========== mensagem nova → avisa o outro participante ==========
create or replace function public.mensagens_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinatario uuid;
  v_remetente text;
begin
  select case when c.participante_1_id = new.remetente_id then c.participante_2_id else c.participante_1_id end
  into v_destinatario
  from public.conversas c
  where c.id = new.conversa_id;

  if v_destinatario is null then
    return new;
  end if;

  select coalesce(nome_completo, 'Alguém') into v_remetente
  from public.profiles where id = new.remetente_id;

  perform public.notificar_push(
    v_destinatario,
    v_remetente,
    left(new.conteudo, 120),
    jsonb_build_object('tipo', 'mensagem', 'conversa_id', new.conversa_id)
  );

  return new;
end;
$$;

create trigger mensagens_notificar
  after insert on public.mensagens
  for each row execute function public.mensagens_notificar();

-- ========== candidatura nova → avisa o dono do bico ==========
create or replace function public.candidaturas_notificar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dono uuid;
  v_titulo text;
  v_candidato text;
begin
  select criado_por, titulo into v_dono, v_titulo
  from public.bicos where id = new.bico_id;

  if v_dono is null then
    return new;
  end if;

  select coalesce(nome_completo, 'Alguém') into v_candidato
  from public.profiles where id = new.candidato_id;

  perform public.notificar_push(
    v_dono,
    'Nova candidatura',
    v_candidato || ' se candidatou a "' || v_titulo || '"',
    jsonb_build_object('tipo', 'candidatura', 'bico_id', new.bico_id)
  );

  return new;
end;
$$;

create trigger candidaturas_notificar
  after insert on public.candidaturas
  for each row execute function public.candidaturas_notificar();
