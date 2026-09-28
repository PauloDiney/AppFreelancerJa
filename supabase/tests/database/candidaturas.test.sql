-- Regras de candidatura e de escolha do prestador (0019): quem pode se
-- candidatar, quando, quantas vezes, e quem pode aceitar/retirar.
-- Roda com `supabase test db` (transação com rollback).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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

-- id da candidatura de um usuário num bico (lida como postgres, sem RLS).
create function testes_seguranca.candidatura(p_bico uuid, p_candidato uuid) returns uuid
language sql security definer as $$
  select id from public.candidaturas where bico_id = p_bico and candidato_id = p_candidato;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 dono · 2201..2206 candidatos · 3333 sem relação
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dono@teste.dev'),
  ('22222222-2222-2222-2222-222222222201', 'c1@teste.dev'),
  ('22222222-2222-2222-2222-222222222202', 'c2@teste.dev'),
  ('22222222-2222-2222-2222-222222222203', 'c3@teste.dev'),
  ('22222222-2222-2222-2222-222222222204', 'c4@teste.dev'),
  ('22222222-2222-2222-2222-222222222205', 'c5@teste.dev'),
  ('22222222-2222-2222-2222-222222222206', 'c6@teste.dev'),
  ('33333333-3333-3333-3333-333333333333', 'outro@teste.dev');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Montar móveis'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Carreto'),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Faxina');

-- ========== quem pode se candidatar ==========
select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000001') $$),
  'CANNOT_APPLY_OWN_JOB',
  'dono não se candidata ao próprio bico (RPC)'
);

select is(
  testes_seguranca.codigo_erro($$
    insert into public.candidaturas (bico_id, candidato_id)
    values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') $$),
  'CANNOT_APPLY_OWN_JOB',
  'dono não se candidata ao próprio bico (INSERT direto)'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');

select isnt(
  public.candidatar_se('b0000000-0000-0000-0000-000000000001', 'Tenho ferramentas'),
  null,
  'candidato se candidata e recebe o id da candidatura'
);

select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000001') $$),
  'APPLICATION_ALREADY_EXISTS',
  'não dá pra se candidatar duas vezes (RPC)'
);

select is(
  testes_seguranca.codigo_erro($$
    insert into public.candidaturas (bico_id, candidato_id)
    values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201') $$),
  '23505',
  'não dá pra se candidatar duas vezes (INSERT direto)'
);

select throws_ok(
  $$ update public.candidaturas set status = 'aceita'
     where bico_id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'candidato não muda o status da própria candidatura'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');

insert into public.candidaturas (bico_id, candidato_id, status)
values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222202', 'aceita');

select is(
  (select status from public.candidaturas
   where bico_id = 'b0000000-0000-0000-0000-000000000001' and candidato_id = '22222222-2222-2222-2222-222222222202'),
  'pendente',
  'status enviado pelo cliente no INSERT é ignorado (nasce pendente)'
);

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222202'))),
  'NOT_JOB_OWNER',
  'candidato não aceita a própria candidatura'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222203');
select public.candidatar_se('b0000000-0000-0000-0000-000000000001');

select is(
  testes_seguranca.codigo_erro(format('select public.retirar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201'))),
  'APPLICATION_NOT_FOUND',
  'ninguém retira a candidatura de outra pessoa'
);

select is(
  testes_seguranca.codigo_erro(format('select public.retirar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222203'))),
  'OK',
  'candidato retira a própria candidatura pendente'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201'))),
  'NOT_JOB_OWNER',
  'quem não é dono do bico não aceita candidatura'
);

select is(
  (select count(*)::int from public.candidaturas where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  0,
  'terceiro não vê as candidaturas de um bico alheio'
);

-- ========== aceitação ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.aceitar_candidatura('00000000-0000-0000-0000-000000000000') $$),
  'APPLICATION_NOT_FOUND',
  'candidatura inexistente'
);

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222203'))),
  'APPLICATION_NOT_PENDING',
  'quem retirou a candidatura não pode ser escolhido'
);

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201'))),
  'OK',
  'dono aceita uma candidatura'
);

select is(
  (select string_agg(status, ',' order by candidato_id) from public.candidaturas
   where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  'aceita,recusada,retirada',
  'a escolhida fica aceita, as outras pendentes viram recusadas e a retirada continua retirada'
);

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222202'))),
  'JOB_ALREADY_ASSIGNED',
  'segundo prestador não pode ser aceito'
);

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201'))),
  'OK',
  'repetir a mesma aceitação (toque duplo) não dá erro'
);

select is(
  (select count(*)::int from public.candidaturas
   where bico_id = 'b0000000-0000-0000-0000-000000000001' and status = 'aceita'),
  1,
  'continua existindo exatamente uma candidatura aceita'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222204');

select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000001') $$),
  'JOB_NOT_OPEN',
  'bico que saiu de aberto não recebe candidaturas'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222201');

select is(
  testes_seguranca.codigo_erro(format('select public.retirar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222201'))),
  'APPLICATION_NOT_PENDING',
  'candidatura já aceita não pode ser retirada (cancelar o bico é outro fluxo)'
);

-- ========== o banco garante um aceito por bico, mesmo para role privilegiado ==========
select testes_seguranca.sair();

select is(
  testes_seguranca.codigo_erro($$
    update public.candidaturas set status = 'aceita'
    where bico_id = 'b0000000-0000-0000-0000-000000000001' and candidato_id = '22222222-2222-2222-2222-222222222202' $$),
  '23505',
  'índice único impede duas candidaturas aceitas no mesmo bico'
);

-- ========== conta suspensa ==========
update public.profiles set status_conta = 'suspenso' where id = '22222222-2222-2222-2222-222222222205';
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222205');

select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000002') $$),
  'ACCOUNT_SUSPENDED',
  'conta suspensa não se candidata'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222206');
select public.candidatar_se('b0000000-0000-0000-0000-000000000002');
select testes_seguranca.sair();
update public.profiles set status_conta = 'suspenso' where id = '22222222-2222-2222-2222-222222222206';
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro(format('select public.aceitar_candidatura(%L)',
    testes_seguranca.candidatura('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222206'))),
  'APPLICANT_UNAVAILABLE',
  'candidato suspenso depois de se candidatar não pode ser escolhido'
);

-- ========== RPC antiga continua funcionando para builds antigos ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222202');
select public.candidatar_se('b0000000-0000-0000-0000-000000000003');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$
    select public.escolher_candidato('b0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222202') $$),
  'OK',
  'escolher_candidato (build antigo) passa pela mesma regra nova'
);

select is(
  (select status from public.bicos where id = 'b0000000-0000-0000-0000-000000000003'),
  'atribuido',
  'e leva o bico ao estado novo (atribuido)'
);

select testes_seguranca.sair();

select * from finish();
rollback;
