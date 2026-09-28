-- Regras de negócio do ciclo de vida de um bico (0010, 0011, 0015, 0018):
-- quem pode criar, se candidatar, escolher, conversar, concluir e avaliar.
-- Roda com `supabase test db`. Tudo acontece numa transação que termina em
-- rollback, então nada fica gravado no banco local.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- Troca o usuário "logado" do mesmo jeito que o PostgREST faz: role
-- authenticated + claims do JWT (que é de onde auth.uid() lê o sub).
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

grant execute on all functions in schema testes_seguranca to public;

-- 1111 contratante · 2222 prestador · 3333 atacante · 4444 vítima
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'contratante@teste.dev', '{"nome_completo":"Contratante"}'),
  ('22222222-2222-2222-2222-222222222222', 'prestador@teste.dev', '{"nome_completo":"Prestador"}'),
  ('33333333-3333-3333-3333-333333333333', 'atacante@teste.dev', '{"nome_completo":"Atacante"}'),
  ('44444444-4444-4444-4444-444444444444', 'vitima@teste.dev', '{"nome_completo":"Vitima"}');

-- ========== C2: nada de ciclo de vida forjado no INSERT ==========
select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.bicos (criado_por, titulo, status, candidato_selecionado_id)
     values ('33333333-3333-3333-3333-333333333333', 'Bico forjado', 'concluido', '44444444-4444-4444-4444-444444444444') $$,
  'P0001', null,
  'bico não nasce concluído com um prestador escolhido pelo cliente'
);

select throws_ok(
  $$ insert into public.bicos (criado_por, titulo, candidato_selecionado_id)
     values ('33333333-3333-3333-3333-333333333333', 'Bico forjado', '44444444-4444-4444-4444-444444444444') $$,
  'P0001', null,
  'bico não nasce com candidato_selecionado_id preenchido'
);

select throws_ok(
  $$ insert into public.bicos (criado_por, titulo, status)
     values ('33333333-3333-3333-3333-333333333333', 'Bico forjado', 'em_andamento') $$,
  'P0001', null,
  'bico não nasce em_andamento'
);

insert into public.bicos (id, criado_por, titulo, criado_em)
values ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Bico do atacante', now() + interval '10 years');

select is(
  (select criado_em from public.bicos where id = 'a0000000-0000-0000-0000-000000000001'),
  now(),
  'criado_em enviado pelo cliente é ignorado (não fixa o bico no topo do feed)'
);

select throws_ok(
  $$ update public.bicos set criado_em = now() + interval '10 years' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'criado_em também não muda por UPDATE'
);

select throws_ok(
  $$ insert into public.conversas (bico_id, participante_1_id, participante_2_id)
     values ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  'sem prestador escolhido de verdade não existe conversa com a vítima'
);

select throws_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'prestador', 1) $$,
  '42501', null,
  'não dá pra avaliar quem nunca trabalhou no bico'
);

select testes_seguranca.sair();

select is(
  (select nota_media_como_prestador from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  null,
  'reputação da vítima continua intacta'
);

-- ========== fluxo legítimo: publicar e se candidatar ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

insert into public.bicos (id, criado_por, titulo, valor_oferecido)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pintar muro', 150);

select is(
  (select status || '/' || coalesce(candidato_selecionado_id::text, '-') from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'aberto/-',
  'bico legítimo nasce aberto e sem prestador'
);

-- A candidatura do próprio dono entra pelo role privilegiado de propósito:
-- o que está sendo testado aqui é que ele não consegue se ESCOLHER.
select testes_seguranca.sair();
insert into public.candidaturas (bico_id, candidato_id)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ select public.escolher_candidato('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111') $$,
  'P0001', null,
  'dono não pode ser o prestador do próprio bico'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.candidaturas (bico_id, candidato_id)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  'prestador se candidata a bico aberto'
);

select throws_ok(
  $$ insert into public.candidaturas (bico_id, candidato_id)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  '23505', null,
  'não dá pra se candidatar duas vezes'
);

select throws_ok(
  $$ update public.candidaturas set status = 'aceita'
     where bico_id = 'b0000000-0000-0000-0000-000000000001'
       and candidato_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'candidato não se autoaprova'
);

-- RLS de UPDATE em bicos filtra pelo dono: pra quem não é, o update afeta 0 linhas.
update public.bicos
set status = 'em_andamento', candidato_selecionado_id = '22222222-2222-2222-2222-222222222222'
where id = 'b0000000-0000-0000-0000-000000000001';

select testes_seguranca.sair();

select is(
  (select status from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'aberto',
  'candidato não se atribui como prestador escolhido'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.candidaturas where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  0,
  'terceiro não vê as candidaturas de um bico alheio'
);

select throws_ok(
  $$ select public.escolher_candidato('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  'P0001', null,
  'terceiro não escolhe candidato em bico alheio'
);

-- ========== escolha, conversa e mensagens ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.escolher_candidato('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222') $$,
  'dono escolhe o candidato pela RPC'
);

select throws_ok(
  $$ update public.bicos set candidato_selecionado_id = '33333333-3333-3333-3333-333333333333'
     where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'prestador escolhido não pode ser trocado'
);

select lives_ok(
  $$ insert into public.conversas (id, bico_id, participante_1_id, participante_2_id)
     values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') $$,
  'dono e prestador escolhido abrem a conversa'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

insert into public.mensagens (id, conversa_id, remetente_id, conteudo)
values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'Combinado, chego às 8h');

select throws_ok(
  $$ update public.mensagens set conteudo = 'adulterada' where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'participante não reescreve o conteúdo de mensagens'
);

select throws_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             '11111111-1111-1111-1111-111111111111', 'contratante', 5) $$,
  '42501', null,
  'não dá pra avaliar antes de o bico ser concluído'
);

-- Prestador tentando concluir o bico do contratante: 0 linhas afetadas.
update public.bicos set status = 'concluido' where id = 'b0000000-0000-0000-0000-000000000001';

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.candidaturas (bico_id, candidato_id)
     values ('b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333') $$,
  '42501', null,
  'não dá pra se candidatar a bico que já saiu de aberto'
);

select is(
  (select count(*)::int from public.mensagens where conversa_id = 'c0000000-0000-0000-0000-000000000001'),
  0,
  'terceiro não lê mensagens de conversa alheia'
);

select throws_ok(
  $$ insert into public.mensagens (conversa_id, remetente_id, conteudo)
     values ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'intrusa') $$,
  '42501', null,
  'terceiro não escreve em conversa alheia'
);

select testes_seguranca.sair();

select is(
  (select status from public.bicos where id = 'b0000000-0000-0000-0000-000000000001'),
  'em_andamento',
  'prestador não conclui o bico do contratante'
);

-- ========== conclusão e avaliações ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.fechar_bico_e_avaliar('b0000000-0000-0000-0000-000000000001', 5, 'Ótimo serviço') $$,
  'dono conclui e avalia pela RPC'
);

select throws_ok(
  $$ update public.bicos set status = 'aberto' where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'bico concluído não reabre'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             '11111111-1111-1111-1111-111111111111', 'prestador', 5) $$,
  '42501', null,
  'papel_avaliado precisa bater com o papel real de quem é avaliado'
);

select lives_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             '11111111-1111-1111-1111-111111111111', 'contratante', 4) $$,
  'prestador avalia o contratante depois de concluído'
);

select throws_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             '11111111-1111-1111-1111-111111111111', 'contratante', 1) $$,
  '23505', null,
  'avaliação duplicada é recusada'
);

select testes_seguranca.sair();

select is(
  (select nota_media_como_prestador from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  5.00::numeric(3, 2),
  'reputação do prestador recalculada pelo banco'
);

select is(
  (select nota_media_como_contratante from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  4.00::numeric(3, 2),
  'reputação do contratante recalculada pelo banco'
);

-- ========== C2: UPDATE direto só escolhe candidatura ativa ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
insert into public.bicos (id, criado_por, titulo)
values ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Faxina');

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');
insert into public.candidaturas (bico_id, candidato_id)
values ('b0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333');
update public.candidaturas set status = 'retirada'
where bico_id = 'b0000000-0000-0000-0000-000000000002' and candidato_id = '33333333-3333-3333-3333-333333333333';

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.bicos set status = 'em_andamento', candidato_selecionado_id = '33333333-3333-3333-3333-333333333333'
     where id = 'b0000000-0000-0000-0000-000000000002' $$,
  'P0001', null,
  'quem retirou a candidatura não pode ser escolhido (nem por UPDATE direto)'
);

select throws_ok(
  $$ update public.bicos set status = 'em_andamento', candidato_selecionado_id = '44444444-4444-4444-4444-444444444444'
     where id = 'b0000000-0000-0000-0000-000000000002' $$,
  'P0001', null,
  'quem nunca se candidatou não pode ser escolhido'
);

select testes_seguranca.sair();

select * from finish();
rollback;
