-- Máquina de estados do bico (0018/0019): o bico nasce aberto, só as RPCs
-- mudam o status, cada passo só pode ser dado pela pessoa certa e toda
-- transição fora do grafo é recusada pelo banco — inclusive para roles
-- privilegiados. Roda com `supabase test db` (transação com rollback).
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Troca o usuário "logado" do mesmo jeito que o PostgREST faz: role
-- authenticated + claims do JWT (é de onde auth.uid() lê o sub).
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

-- Executa um comando e devolve o código de domínio do erro (HINT), o
-- SQLSTATE quando não há código, ou 'OK' quando não deu erro.
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

grant execute on all functions in schema testes_seguranca to public;

-- 1111 contratante · 2222 prestador · 3333 atacante · 4444 vítima
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'contratante@teste.dev', '{"nome_completo":"Contratante"}'),
  ('22222222-2222-2222-2222-222222222222', 'prestador@teste.dev', '{"nome_completo":"Prestador"}'),
  ('33333333-3333-3333-3333-333333333333', 'atacante@teste.dev', '{"nome_completo":"Atacante"}'),
  ('44444444-4444-4444-4444-444444444444', 'vitima@teste.dev', '{"nome_completo":"Vitima"}');

-- ========== nada de ciclo de vida forjado no INSERT (auditoria C2) ==========
select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$
    insert into public.bicos (criado_por, titulo, status, candidato_selecionado_id)
    values ('33333333-3333-3333-3333-333333333333', 'Bico forjado', 'concluido', '44444444-4444-4444-4444-444444444444') $$),
  'JOB_MUST_START_OPEN',
  'bico não nasce concluído com um prestador escolhido pelo cliente'
);

select is(
  testes_seguranca.codigo_erro($$
    insert into public.bicos (criado_por, titulo, status)
    values ('33333333-3333-3333-3333-333333333333', 'Bico forjado', 'atribuido') $$),
  'JOB_MUST_START_OPEN',
  'bico não nasce atribuído'
);

insert into public.bicos (id, criado_por, titulo, criado_em, concluido_em)
values ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Bico do atacante',
        now() + interval '10 years', now());

select is(
  (select criado_em from public.bicos where id = 'a0000000-0000-0000-0000-000000000001'),
  now(),
  'criado_em enviado pelo cliente é ignorado (não fixa o bico no topo do feed)'
);

select is(
  (select concluido_em from public.bicos where id = 'a0000000-0000-0000-0000-000000000001'),
  null,
  'carimbos do ciclo de vida enviados pelo cliente são ignorados'
);

select throws_ok(
  $$ insert into public.conversas (bico_id, participante_1_id, participante_2_id)
     values ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  'sem prestador escolhido de verdade não existe conversa com a vítima'
);

-- ========== status e prestador não mudam por UPDATE direto ==========
select throws_ok(
  $$ update public.bicos set status = 'cancelado' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'dono não muda o status por UPDATE direto (só pelas RPCs)'
);

select throws_ok(
  $$ update public.bicos set candidato_selecionado_id = '44444444-4444-4444-4444-444444444444'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'dono não define o prestador por UPDATE direto'
);

select throws_ok(
  $$ update public.bicos set criado_em = now() + interval '10 years' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'dono não reescreve criado_em'
);

select testes_seguranca.sair();

select is(
  testes_seguranca.codigo_erro($$
    update public.bicos set criado_em = now() + interval '10 years'
    where id = 'a0000000-0000-0000-0000-000000000001' $$),
  'JOB_FIELDS_IMMUTABLE',
  'nem role privilegiado reescreve criado_em (trigger vale para todos)'
);

-- ========== fluxo completo pelas RPCs ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

insert into public.bicos (id, criado_por, titulo, valor_oferecido)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pintar muro', 150);

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set titulo = 'Pintar muro e portão' where id = 'b0000000-0000-0000-0000-000000000001' $$),
  'OK',
  'dono edita a descrição enquanto o bico está aberto'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
select public.candidatar_se('b0000000-0000-0000-0000-000000000001', 'Tenho experiência');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$
    select public.aceitar_candidatura(c.id) from public.candidaturas c
    where c.bico_id = 'b0000000-0000-0000-0000-000000000001' $$),
  'OK',
  'dono aceita a candidatura'
);

select is(
  (select status || '/' || candidato_selecionado_id::text || '/' || (atribuido_em is not null)::text
   from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'atribuido/22222222-2222-2222-2222-222222222222/true',
  'aceitar leva o bico a atribuido, com prestador e atribuido_em'
);

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set valor_oferecido = 10 where id = 'b0000000-0000-0000-0000-000000000001' $$),
  'JOB_LOCKED',
  'depois da escolha o combinado (valor, descrição, data) congela'
);

select is(
  testes_seguranca.codigo_erro($$ select public.iniciar_bico('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_SELECTED_WORKER',
  'quem inicia é o prestador, não o contratante'
);

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001') $$),
  'JOB_NOT_AWAITING_CONFIRMATION',
  'contratante não conclui sem o prestador ter finalizado'
);

select is(
  testes_seguranca.codigo_erro($$ select public.fechar_bico_e_avaliar('b0000000-0000-0000-0000-000000000001', 5) $$),
  'JOB_NOT_AWAITING_CONFIRMATION',
  'RPC antiga fechar_bico_e_avaliar também exige o prestador ter finalizado'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.iniciar_bico('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_JOB_PARTICIPANT',
  'usuário sem relação com o bico não inicia o serviço'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.marcar_bico_finalizado('b0000000-0000-0000-0000-000000000001') $$),
  'JOB_NOT_IN_PROGRESS',
  'prestador não finaliza antes de iniciar'
);

select is(
  testes_seguranca.codigo_erro($$ select public.iniciar_bico('b0000000-0000-0000-0000-000000000001') $$),
  'OK',
  'prestador inicia o serviço'
);

select is(
  (select status || '/' || (iniciado_em is not null)::text from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'em_andamento/true',
  'iniciar leva a em_andamento e grava iniciado_em'
);

select is(
  testes_seguranca.codigo_erro($$ select public.iniciar_bico('b0000000-0000-0000-0000-000000000001') $$),
  'OK',
  'iniciar de novo (toque duplo) não dá erro nem muda nada'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.marcar_bico_finalizado('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_JOB_PARTICIPANT',
  'usuário sem relação com o bico não finaliza o serviço'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.marcar_bico_finalizado('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_SELECTED_WORKER',
  'contratante não marca o serviço como finalizado'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.marcar_bico_finalizado('b0000000-0000-0000-0000-000000000001') $$),
  'OK',
  'prestador marca o serviço como finalizado'
);

select is(
  (select status from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'aguardando_confirmacao',
  'finalizar NÃO conclui: fica aguardando a confirmação do contratante'
);

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_JOB_OWNER',
  'prestador não confirma a própria conclusão'
);

select throws_ok(
  $$ update public.bicos set status = 'concluido' where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'prestador não conclui por UPDATE direto'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001') $$),
  'NOT_JOB_OWNER',
  'usuário sem relação com o bico não confirma a conclusão'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001') $$),
  'OK',
  'contratante confirma a conclusão'
);

select is(
  (select status || '/' || (concluido_em is not null and finalizado_pelo_prestador_em is not null)::text
   from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'concluido/true',
  'bico concluído com os carimbos de finalização e conclusão'
);

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000001') $$),
  'OK',
  'confirmar de novo não dá erro nem muda nada'
);

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'outro', 'desisti depois') $$),
  'CANCELLATION_NOT_ALLOWED',
  'bico concluído não pode ser cancelado'
);

-- ========== transições fora do grafo, mesmo com role privilegiado ==========
select testes_seguranca.sair();

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set status = 'aberto' where id = 'b0000000-0000-0000-0000-000000000001' $$),
  'INVALID_JOB_TRANSITION',
  'bico concluído não reabre'
);

insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Faxina');

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set status = 'concluido' where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'INVALID_JOB_TRANSITION',
  'aberto não pula direto para concluído'
);

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set status = 'em_andamento' where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'INVALID_JOB_TRANSITION',
  'aberto não pula para em_andamento sem ser atribuído'
);

select is(
  testes_seguranca.codigo_erro($$
    update public.bicos set status = 'atribuido', candidato_selecionado_id = '44444444-4444-4444-4444-444444444444'
    where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'APPLICATION_NOT_PENDING',
  'nem role privilegiado atribui a quem não se candidatou'
);

select is(
  testes_seguranca.codigo_erro($$
    update public.bicos set status = 'atribuido', candidato_selecionado_id = '11111111-1111-1111-1111-111111111111'
    where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'CANNOT_SELECT_OWNER',
  'dono nunca é o prestador do próprio bico'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
select public.candidatar_se('b0000000-0000-0000-0000-000000000002');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
select public.aceitar_candidatura(c.id) from public.candidaturas c where c.bico_id = 'b0000000-0000-0000-0000-000000000002';
select testes_seguranca.sair();

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set status = 'aguardando_confirmacao' where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'INVALID_JOB_TRANSITION',
  'atribuido não pula a etapa de início'
);

select is(
  testes_seguranca.codigo_erro($$
    update public.bicos set candidato_selecionado_id = '33333333-3333-3333-3333-333333333333'
    where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'JOB_ALREADY_ASSIGNED',
  'prestador escolhido não pode ser trocado'
);

select is(
  testes_seguranca.codigo_erro($$ update public.bicos set status = 'em_disputa' where id = 'b0000000-0000-0000-0000-000000000002' $$),
  'INVALID_JOB_TRANSITION',
  'disputa só a partir do serviço em andamento'
);

select is(
  (select iniciado_em from public.bicos where id = 'b0000000-0000-0000-0000-000000000002'),
  null,
  'carimbo de início só existe depois do início'
);

select * from finish();
rollback;
