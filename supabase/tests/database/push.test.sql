-- Pipeline de push (0017 + 0018): o INSERT de mensagem/candidatura nunca
-- depende do push, o banco só chama a Edge Function com o segredo dedicado do
-- Vault, e a service_role key não mora mais em setting do banco.
-- Roda com `supabase test db` (transação com rollback no final — os segredos
-- criados aqui no Vault também são desfeitos).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create schema testes_seguranca;
grant usage on schema testes_seguranca to public;

create function testes_seguranca.entrar_como(p_usuario uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function testes_seguranca.sair() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Cria ou atualiza um segredo do Vault (o banco local pode já ter um com o
-- mesmo nome; tudo volta ao estado anterior no rollback).
create function testes_seguranca.definir_segredo(p_nome text, p_valor text) returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.decrypted_secrets where name = p_nome;
  if v_id is null then
    perform vault.create_secret(p_valor, p_nome);
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end;
$$;

-- Pedidos que a função enfileirou no pg_net para o endereço de teste.
create function testes_seguranca.pushes() returns setof net.http_request_queue
language sql as $$
  select * from net.http_request_queue
  where url = 'https://teste-auditoria.invalid/functions/v1/enviar-push'
  order by id;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 contratante · 2222 prestador · 3333 outro candidato
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'contratante@teste.dev', '{"nome_completo":"Contratante"}'),
  ('22222222-2222-2222-2222-222222222222', 'prestador@teste.dev', '{"nome_completo":"Prestador"}'),
  ('33333333-3333-3333-3333-333333333333', 'outro@teste.dev', '{"nome_completo":"Outro"}');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Montar móveis');

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
insert into public.candidaturas (bico_id, candidato_id)
values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.escolher_candidato('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
insert into public.conversas (id, bico_id, participante_1_id, participante_2_id)
values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- ========== sem segredos no Vault: o app funciona, só não notifica ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.mensagens (conversa_id, remetente_id, conteudo)
     values ('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Oi, tudo certo?') $$,
  'sem segredos configurados, mandar mensagem continua funcionando'
);

select testes_seguranca.sair();

select is((select count(*)::int from testes_seguranca.pushes()), 0, 'sem segredos configurados nada é enfileirado');

-- ========== com os segredos: um push por evento, autenticado pelo segredo dedicado ==========
select testes_seguranca.definir_segredo('push_project_url', 'https://teste-auditoria.invalid/');
select testes_seguranca.definir_segredo('push_webhook_secret', 'segredo-de-teste');

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.mensagens (conversa_id, remetente_id, conteudo)
     values ('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Chego às 8h') $$,
  'com segredos configurados, mandar mensagem funciona (H3: antes falhava com 42883)'
);

select testes_seguranca.sair();

select is((select count(*)::int from testes_seguranca.pushes()), 1, 'mensagem enfileira exatamente um push para a enviar-push');

select is(
  (select headers ->> 'x-push-secret' from testes_seguranca.pushes() limit 1),
  'segredo-de-teste',
  'push se autentica com o segredo dedicado do Vault'
);

select ok(
  (select not (headers ? 'Authorization') from testes_seguranca.pushes() limit 1),
  'push não manda mais a service_role key no Authorization'
);

select is(
  (select convert_from(body, 'UTF8')::jsonb ->> 'usuario_id' from testes_seguranca.pushes() limit 1),
  '11111111-1111-1111-1111-111111111111',
  'push da mensagem vai para o OUTRO participante'
);

select is(
  (select convert_from(body, 'UTF8')::jsonb -> 'dados' ->> 'tipo' from testes_seguranca.pushes() limit 1),
  'mensagem',
  'push da mensagem leva o tipo certo pra navegação no app'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Carreto');

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.candidaturas (bico_id, candidato_id)
     values ('b0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333') $$,
  'com segredos configurados, se candidatar funciona (H3: antes falhava com 42883)'
);

select testes_seguranca.sair();

select is(
  (select convert_from(body, 'UTF8')::jsonb ->> 'usuario_id' from testes_seguranca.pushes() order by id desc limit 1),
  '11111111-1111-1111-1111-111111111111',
  'push da candidatura vai para o dono do bico'
);

-- Segredo vazio conta como "não configurado" (a 0017 só testava null).
select testes_seguranca.definir_segredo('push_webhook_secret', '');

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
insert into public.mensagens (conversa_id, remetente_id, conteudo)
values ('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Mais uma');
select testes_seguranca.sair();

select is((select count(*)::int from testes_seguranca.pushes()), 2, 'segredo vazio conta como não configurado');

-- ========== permissões e segredos fora do banco ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ select public.notificar_push('11111111-1111-1111-1111-111111111111', 'Falso', 'Phishing', '{}'::jsonb) $$,
  '42501', null,
  'o app não chama notificar_push diretamente'
);

select testes_seguranca.sair();

select is(
  (select count(*)::int
   from pg_db_role_setting s
   where s.setdatabase = (select oid from pg_database where datname = current_database())
     and array_to_string(s.setconfig, ',') like '%app.settings.service_role_key%'),
  0,
  'service_role key não fica mais em setting do banco'
);

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notificar_push'
     and pg_get_functiondef(p.oid) like '%app.settings%'),
  0,
  'notificar_push não lê mais nenhum app.settings.*'
);

select * from finish();
rollback;
