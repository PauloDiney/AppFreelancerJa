-- Notificações do ciclo de vida (0019): cada evento avisa a pessoa certa,
-- uma vez só, sem revelar nota de avaliação, e nenhuma falha de notificação
-- desfaz a ação que a gerou. Roda com `supabase test db` (rollback no final).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

create function testes_seguranca.codigo_erro(p_sql text) returns text
language plpgsql as $$
declare
  v_hint text;
  v_estado text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_estado = returned_sqlstate;
  return coalesce(nullif(v_hint, ''), v_estado);
end;
$$;

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

-- Notificações de um usuário e tipo (lidas como postgres, sem RLS).
create function testes_seguranca.avisos(p_usuario uuid, p_tipo text) returns integer
language sql security definer as $$
  select count(*)::int from public.notificacoes where usuario_id = p_usuario and tipo = p_tipo;
$$;

create function testes_seguranca.pushes() returns setof net.http_request_queue
language sql as $$
  select * from net.http_request_queue
  where url = 'https://teste-auditoria.invalid/functions/v1/enviar-push'
  order by id;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 dono · 2201 escolhido · 2202 não escolhido · 3333 sem relação
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'dono@teste.dev', '{"nome_completo":"Dona Maria"}'),
  ('22222222-2222-2222-2222-222222222201', 'c1@teste.dev', '{"nome_completo":"João"}'),
  ('22222222-2222-2222-2222-222222222202', 'c2@teste.dev', '{"nome_completo":"Ana"}'),
  ('33333333-3333-3333-3333-333333333333', 'outro@teste.dev', '{"nome_completo":"Outro"}');

-- Push configurado para um endereço de teste: prova que o evento chega à fila.
select testes_seguranca.definir_segredo('push_project_url', 'https://teste-auditoria.invalid');
select testes_seguranca.definir_segredo('push_webhook_secret', 'segredo-de-teste');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Trocar chuveiro'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Lavar quintal');

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');
select public.candidatar_se('b0000000-0000-0000-0000-000000000001');
select public.candidatar_se('b0000000-0000-0000-0000-000000000002');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');
select public.candidatar_se('b0000000-0000-0000-0000-000000000001');
select public.candidatar_se('b0000000-0000-0000-0000-000000000002');
select testes_seguranca.sair();

select is(
  testes_seguranca.avisos('11111111-1111-1111-1111-111111111111', 'candidatura_recebida'),
  4,
  'dono recebe um aviso por candidatura'
);

-- ========== escolha ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.aceitar_candidatura(c.id) from public.candidaturas c
where c.bico_id = 'b0000000-0000-0000-0000-000000000001' and c.candidato_id = '22222222-2222-2222-2222-222222222201';
select public.aceitar_candidatura(c.id) from public.candidaturas c
where c.bico_id = 'b0000000-0000-0000-0000-000000000001' and c.candidato_id = '22222222-2222-2222-2222-222222222201';
select testes_seguranca.sair();

select is(
  testes_seguranca.avisos('22222222-2222-2222-2222-222222222201', 'candidatura_aceita'),
  1,
  'escolhido recebe um único aviso, mesmo com a aceitação repetida'
);

select is(
  testes_seguranca.avisos('22222222-2222-2222-2222-222222222202', 'candidatura_recusada'),
  1,
  'quem não foi escolhido fica sabendo'
);

select is(
  (select corpo from public.notificacoes
   where usuario_id = '22222222-2222-2222-2222-222222222201' and tipo = 'candidatura_aceita'),
  'Dona Maria escolheu você para "Trocar chuveiro". Combine os detalhes pelo chat.',
  'texto do aviso de escolha'
);

-- ========== início, fim e confirmação ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');
select public.iniciar_bico('b0000000-0000-0000-0000-000000000001');
select public.iniciar_bico('b0000000-0000-0000-0000-000000000001');
select public.marcar_bico_finalizado('b0000000-0000-0000-0000-000000000001');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001');
select testes_seguranca.sair();

select is(
  testes_seguranca.avisos('11111111-1111-1111-1111-111111111111', 'bico_iniciado'),
  1,
  'dono é avisado do início uma vez só (início repetido não avisa de novo)'
);

select is(
  testes_seguranca.avisos('11111111-1111-1111-1111-111111111111', 'bico_finalizado'),
  1,
  'dono é avisado de que o prestador finalizou'
);

select is(
  testes_seguranca.avisos('22222222-2222-2222-2222-222222222201', 'bico_concluido'),
  1,
  'prestador é avisado da conclusão'
);

select is(
  (select count(*)::int from testes_seguranca.pushes()
   where convert_from(body, 'UTF8')::jsonb -> 'dados' ->> 'tipo' = 'bico_iniciado'),
  1,
  'evento do ciclo de vida chega à fila de push, uma vez'
);

select is(
  (select convert_from(body, 'UTF8')::jsonb -> 'dados' ->> 'bico_id' from testes_seguranca.pushes()
   where convert_from(body, 'UTF8')::jsonb -> 'dados' ->> 'tipo' = 'bico_concluido'),
  'b0000000-0000-0000-0000-000000000001',
  'push leva o bico para o app abrir a tela certa'
);

-- ========== avaliações: aviso sem a nota ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 2, 'Deixou sujeira');
select testes_seguranca.sair();

select ok(
  (select corpo not like '%2%' and corpo like '%Avalie também%' from public.notificacoes
   where usuario_id = '22222222-2222-2222-2222-222222222201' and tipo = 'avaliacao_recebida'),
  'aviso de avaliação não conta a nota e convida a avaliar'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');
select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 5);
select testes_seguranca.sair();

select ok(
  (select corpo like '%já estão visíveis%' from public.notificacoes
   where usuario_id = '11111111-1111-1111-1111-111111111111' and tipo = 'avaliacao_recebida'),
  'segunda avaliação avisa que as duas já estão visíveis'
);

-- ========== cancelamento e disputa ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.cancelar_bico('b0000000-0000-0000-0000-000000000002', 'problema_de_agenda');
select testes_seguranca.sair();

select is(
  testes_seguranca.avisos('22222222-2222-2222-2222-222222222201', 'bico_cancelado')
    + testes_seguranca.avisos('22222222-2222-2222-2222-222222222202', 'bico_cancelado'),
  2,
  'cancelar bico aberto avisa cada candidato pendente'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Podar árvore');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');
select public.candidatar_se('b0000000-0000-0000-0000-000000000003');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.aceitar_candidatura(c.id) from public.candidaturas c where c.bico_id = 'b0000000-0000-0000-0000-000000000003';
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');
select public.iniciar_bico('b0000000-0000-0000-0000-000000000003');
select public.abrir_disputa('b0000000-0000-0000-0000-000000000003', 'problema_de_pagamento', 'Combinamos metade adiantado e não veio');
select testes_seguranca.sair();

select is(
  testes_seguranca.avisos('11111111-1111-1111-1111-111111111111', 'disputa_aberta'),
  1,
  'a outra parte é avisada da disputa'
);

select is(
  testes_seguranca.avisos('22222222-2222-2222-2222-222222222202', 'disputa_aberta'),
  0,
  'quem abriu a disputa não é avisado de si mesmo'
);

-- ========== quem vê o quê ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');

select is(
  (select count(*)::int from public.notificacoes where usuario_id <> '22222222-2222-2222-2222-222222222202'),
  0,
  'usuário só vê as próprias notificações'
);

select ok(
  (select count(*) from public.notificacoes) > 0,
  'e vê as próprias'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.notificacoes), 0, 'quem não participou de nada não vê notificação nenhuma');

select throws_ok(
  $$ insert into public.notificacoes (usuario_id, tipo, chave, titulo, corpo)
     values ('11111111-1111-1111-1111-111111111111', 'bico_concluido', 'falsa', 'Golpe', 'Clique aqui') $$,
  '42501', null,
  'ninguém cria notificação para outra pessoa'
);

select throws_ok(
  $$ select public.notificar_evento('11111111-1111-1111-1111-111111111111', 'bico_concluido', null, 'falsa', 'Golpe', 'Clique aqui') $$,
  '42501', null,
  'o app não chama a função interna de notificação'
);

-- ========== deduplicação e isolamento de falhas ==========
select testes_seguranca.sair();

select public.notificar_evento('33333333-3333-3333-3333-333333333333', 'bico_iniciado', null, 'teste:dedup', 'Teste', 'Teste');
select public.notificar_evento('33333333-3333-3333-3333-333333333333', 'bico_iniciado', null, 'teste:dedup', 'Teste', 'Teste');

select is(
  testes_seguranca.avisos('33333333-3333-3333-3333-333333333333', 'bico_iniciado'),
  1,
  'mesma chave de evento não gera segundo aviso'
);

select is(
  testes_seguranca.codigo_erro($$
    select public.notificar_evento('33333333-3333-3333-3333-333333333333', 'tipo_que_nao_existe', null, 'teste:falha', 'x', 'y') $$),
  'OK',
  'falha ao registrar a notificação não propaga erro'
);

select is(
  (select count(*)::int from public.notificacoes where chave = 'teste:falha'),
  0,
  'e não deixa registro pela metade'
);

-- Ação continua valendo mesmo com a notificação quebrada: o segredo de push
-- vazio desliga o envio, e o tipo inválido acima mostrou o caminho de erro.
select testes_seguranca.definir_segredo('push_webhook_secret', '');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Instalar prateleira');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');

select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000004') $$),
  'OK',
  'candidatura funciona com o push desligado'
);

select testes_seguranca.sair();

-- 2 + 2 candidaturas nos dois primeiros bicos, 1 no da disputa, 1 agora.
select is(
  testes_seguranca.avisos('11111111-1111-1111-1111-111111111111', 'candidatura_recebida'),
  6,
  'e o aviso fica registrado para o app mesmo sem push'
);

select * from finish();
rollback;
