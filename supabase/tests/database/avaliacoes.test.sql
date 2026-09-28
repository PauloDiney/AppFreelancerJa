-- Avaliações e reputação (0019): quem avalia quem e quando, avaliação cega
-- (só aparece quando os dois avaliam ou o prazo acaba), imutabilidade, e
-- reputação calculada só com o que já é público.
-- Roda com `supabase test db` (transação com rollback).
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

create function testes_seguranca.entrar_como_servico() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
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

-- Leva um bico recém-criado (dono 1111, prestador 2222) até o estado pedido
-- pelas RPCs.
create function testes_seguranca.preparar_bico(p_bico uuid, p_estado text) returns void
language plpgsql as $$
begin
  perform testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
  insert into public.bicos (id, criado_por, titulo) values (p_bico, '11111111-1111-1111-1111-111111111111', 'Bico de teste');
  perform testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
  perform public.candidatar_se(p_bico);
  perform testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
  perform public.aceitar_candidatura(c.id) from public.candidaturas c where c.bico_id = p_bico;
  perform testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
  perform public.iniciar_bico(p_bico);
  if p_estado in ('aguardando_confirmacao', 'concluido') then
    perform public.marcar_bico_finalizado(p_bico);
  end if;
  if p_estado = 'concluido' then
    perform testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
    perform public.confirmar_conclusao_bico(p_bico);
  end if;
  perform testes_seguranca.sair();
end;
$$;

-- Simula a passagem do tempo: recua a data de conclusão (o trigger não deixa
-- ninguém mexer nos carimbos, então ele é desligado só aqui dentro).
create function testes_seguranca.recuar_conclusao(p_bico uuid, p_intervalo interval) returns void
language plpgsql as $$
begin
  alter table public.bicos disable trigger bicos_validar_transicao;
  update public.bicos set concluido_em = concluido_em - p_intervalo where id = p_bico;
  alter table public.bicos enable trigger bicos_validar_transicao;
end;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 contratante · 2222 prestador · 3333 sem relação
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'contratante@teste.dev'),
  ('22222222-2222-2222-2222-222222222222', 'prestador@teste.dev'),
  ('33333333-3333-3333-3333-333333333333', 'outro@teste.dev');

select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000001', 'concluido');
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000002', 'em_andamento');

-- ========== quem pode avaliar ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000002', 5) $$),
  'REVIEW_NOT_ALLOWED',
  'não dá pra avaliar antes de o bico ser concluído'
);

select throws_ok(
  $$ insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
     values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222', 'prestador', 5) $$,
  '42501', null,
  'avaliação não é gravada direto na tabela (identidades vêm do auth.uid() na RPC)'
);

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 0) $$),
  'INVALID_RATING',
  'nota abaixo de 1 é recusada'
);

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 6) $$),
  'INVALID_RATING',
  'nota acima de 5 é recusada'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 1, 'Nunca trabalhei com ele') $$),
  'REVIEW_NOT_ALLOWED',
  'quem não participou do bico não avalia ninguém'
);

-- ========== avaliação cega ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 5, 'Ótimo trabalho') $$),
  'OK',
  'contratante avalia o prestador'
);

select is(
  (select avaliado_id::text || '/' || papel_avaliado from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222/prestador',
  'avaliado e papel derivados do bico, não do cliente'
);

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 1) $$),
  'REVIEW_ALREADY_EXISTS',
  'avaliação duplicada é recusada'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  0,
  'prestador ainda não vê a nota que recebeu (avaliação cega)'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  0,
  'terceiros também não veem antes da revelação'
);

select is(
  (select coalesce(nota_media_como_prestador::text, 'sem nota') || '/' || total_avaliacoes_como_prestador
   from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'sem nota/0',
  'reputação não muda com avaliação escondida (não dá pra deduzir a nota)'
);

select is(
  (select total_bicos_como_prestador from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'bico concluído já conta no total do prestador'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000001', 4, 'Pagou certinho') $$),
  'OK',
  'prestador avalia o contratante'
);

select is(
  (select count(*)::int from public.avaliacoes
   where bico_id = 'b0000000-0000-0000-0000-000000000001' and revelada_em is not null),
  2,
  'com as duas avaliações feitas, as duas são reveladas'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000001'),
  2,
  'depois da revelação qualquer usuário vê as duas'
);

select is(
  (select nota_media_como_prestador::text || '/' || total_avaliacoes_como_prestador
   from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  '5.00/1',
  'reputação do prestador atualizada na revelação'
);

select is(
  (select nota_media_como_contratante::text || '/' || total_avaliacoes_como_contratante || '/' || total_bicos_como_contratante
   from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '4.00/1/1',
  'reputação do contratante: nota, avaliações e bicos concluídos'
);

select throws_ok(
  $$ update public.profiles set nota_media_como_prestador = 5, total_bicos_como_prestador = 99
     where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'ninguém edita a própria reputação'
);

-- ========== avaliação é imutável ==========
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.avaliacoes set nota = 1 where bico_id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'autor não altera a própria avaliação'
);

select throws_ok(
  $$ delete from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'autor não apaga a própria avaliação'
);

select testes_seguranca.sair();

select is(
  testes_seguranca.codigo_erro($$
    update public.avaliacoes set avaliado_id = '33333333-3333-3333-3333-333333333333'
    where bico_id = 'b0000000-0000-0000-0000-000000000001' and papel_avaliado = 'prestador' $$),
  'REVIEW_IMMUTABLE',
  'nem role privilegiado troca bico, autor, avaliado ou nota de uma avaliação'
);

select is(
  testes_seguranca.codigo_erro($$
    insert into public.avaliacoes (bico_id, avaliador_id, avaliado_id, papel_avaliado, nota)
    values ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
            '11111111-1111-1111-1111-111111111111', 'prestador', 5) $$),
  '23514',
  'autoavaliação é barrada pela própria tabela'
);

-- ========== prazo de 14 dias ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000003', 'concluido');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
select public.avaliar_bico('b0000000-0000-0000-0000-000000000003', 2, 'Atrasou o pagamento');
select testes_seguranca.sair();
select testes_seguranca.recuar_conclusao('b0000000-0000-0000-0000-000000000003', interval '15 days');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.avaliar_bico('b0000000-0000-0000-0000-000000000003', 1, 'Retaliação') $$),
  'REVIEW_WINDOW_CLOSED',
  'depois de 14 dias não se avalia mais (sem avaliar depois de ler a do outro)'
);

select is(
  (select count(*)::int from public.avaliacoes where bico_id = 'b0000000-0000-0000-0000-000000000003'),
  1,
  'com o prazo vencido, a avaliação que ficou sozinha aparece'
);

select throws_ok(
  $$ select public.revelar_avaliacoes_vencidas() $$,
  '42501', null,
  'usuário comum não chama a rotina de revelação'
);

select testes_seguranca.entrar_como_servico();

select is(
  public.revelar_avaliacoes_vencidas(),
  1,
  'rotina agendada revela a avaliação vencida'
);

select testes_seguranca.sair();

select is(
  (select nota_media_como_contratante::text || '/' || total_avaliacoes_como_contratante
   from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '3.00/2',
  'reputação passa a contar a avaliação revelada pelo prazo'
);

-- ========== RPC antiga: confirmar + avaliar numa transação ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000004', 'aguardando_confirmacao');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.fechar_bico_e_avaliar('b0000000-0000-0000-0000-000000000004', 5, 'Tudo certo') $$),
  'OK',
  'fechar_bico_e_avaliar (build antigo) confirma e avalia de uma vez'
);

select is(
  (select b.status || '/' || count(a.id)
   from public.bicos b left join public.avaliacoes a on a.bico_id = b.id
   where b.id = 'b0000000-0000-0000-0000-000000000004'
   group by b.status),
  'concluido/1',
  'bico concluído com a avaliação do contratante'
);

select is(
  testes_seguranca.codigo_erro($$ select public.fechar_bico_e_avaliar('b0000000-0000-0000-0000-000000000004', 1, 'De novo') $$),
  'REVIEW_ALREADY_EXISTS',
  'repetir o fechamento não cria segunda avaliação (e nada muda)'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.fechar_bico_e_avaliar('b0000000-0000-0000-0000-000000000002', 5) $$),
  'NOT_JOB_OWNER',
  'prestador não fecha o bico pela RPC antiga'
);

select is(
  (select count(*)::int from public.avaliacoes a
   where a.bico_id = 'b0000000-0000-0000-0000-000000000002'),
  0,
  'nenhuma avaliação existe para bico não concluído'
);

select testes_seguranca.sair();

select * from finish();
rollback;
