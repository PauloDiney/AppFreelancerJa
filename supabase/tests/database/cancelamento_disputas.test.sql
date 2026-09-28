-- Cancelamento estruturado e disputas (0019): quem pode cancelar em cada
-- estágio, motivos, quem vê o registro, quem abre e quem resolve disputa.
-- Roda com `supabase test db` (transação com rollback).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

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

-- A moderação futura chama com a chave de serviço.
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

-- Leva um bico recém-criado até o estado pedido pelo caminho legítimo das
-- RPCs (dono 1111, prestador 2222).
create function testes_seguranca.preparar_bico(p_bico uuid, p_estado text) returns void
language plpgsql as $$
begin
  perform testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
  insert into public.bicos (id, criado_por, titulo) values (p_bico, '11111111-1111-1111-1111-111111111111', 'Bico de teste');
  if p_estado = 'aberto' then
    perform testes_seguranca.sair();
    return;
  end if;
  perform testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
  perform public.candidatar_se(p_bico);
  perform testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');
  perform public.aceitar_candidatura(c.id) from public.candidaturas c where c.bico_id = p_bico;
  perform testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
  if p_estado in ('em_andamento', 'aguardando_confirmacao') then
    perform public.iniciar_bico(p_bico);
  end if;
  if p_estado = 'aguardando_confirmacao' then
    perform public.marcar_bico_finalizado(p_bico);
  end if;
  perform testes_seguranca.sair();
end;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 dono · 2222 prestador · 3333 sem relação · 4444 só candidato
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dono@teste.dev'),
  ('22222222-2222-2222-2222-222222222222', 'prestador@teste.dev'),
  ('33333333-3333-3333-3333-333333333333', 'outro@teste.dev'),
  ('44444444-4444-4444-4444-444444444444', 'candidato@teste.dev');

-- ========== cancelamento com o bico aberto ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000001', 'aberto');
select testes_seguranca.entrar_como('44444444-4444-4444-4444-444444444444');
select public.candidatar_se('b0000000-0000-0000-0000-000000000001');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'problema_de_agenda') $$),
  'NOT_JOB_PARTICIPANT',
  'candidato (não escolhido) não cancela o bico'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'problema_de_agenda') $$),
  'NOT_JOB_PARTICIPANT',
  'usuário sem relação com o bico não cancela'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'porque_sim') $$),
  'INVALID_CANCELLATION_REASON',
  'motivo fora da lista é recusado'
);

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'outro') $$),
  'CANCELLATION_DETAILS_REQUIRED',
  'motivo "outro" exige detalhes'
);

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'problema_de_agenda', 'Mudei a data') $$),
  'OK',
  'dono cancela o bico aberto'
);

select is(
  (select b.status || '/' || c.motivo || '/' || c.cancelado_por::text
   from public.bicos b join public.cancelamentos c on c.bico_id = b.id
   where b.id = 'b0000000-0000-0000-0000-000000000001'),
  'cancelado/problema_de_agenda/11111111-1111-1111-1111-111111111111',
  'cancelamento registra quem, por quê e deixa o bico cancelado'
);

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000001', 'problema_de_agenda') $$),
  'OK',
  'cancelar de novo não dá erro nem cria outro registro'
);

select testes_seguranca.entrar_como('44444444-4444-4444-4444-444444444444');

select is(
  testes_seguranca.codigo_erro($$ select public.candidatar_se('b0000000-0000-0000-0000-000000000001') $$),
  'JOB_NOT_OPEN',
  'bico cancelado não recebe candidaturas'
);

-- ========== cancelamento com prestador escolhido ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000002', 'atribuido');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000002', 'contratante_indisponivel') $$),
  'OK',
  'prestador pode desistir antes de iniciar'
);

select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000003', 'atribuido');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000003', 'nao_compareceu') $$),
  'OK',
  'dono cancela por não comparecimento antes do início'
);

-- ========== serviço em andamento: só o prestador cancela ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000004', 'em_andamento');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000004', 'desacordo_de_preco') $$),
  'CANCELLATION_NOT_ALLOWED',
  'com o serviço em andamento o dono não cancela sozinho'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000004', 'outro', 'quero cancelar') $$),
  'NOT_JOB_PARTICIPANT',
  'usuário sem relação não cancela bico em andamento'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000004', 'ambiente_inseguro', 'Local sem segurança') $$),
  'OK',
  'prestador pode encerrar o serviço em andamento'
);

-- ========== aguardando confirmação: ninguém cancela ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000005', 'aguardando_confirmacao');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000005', 'outro', 'mudei de ideia') $$),
  'CANCELLATION_NOT_ALLOWED',
  'prestador não cancela depois de dizer que finalizou'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000005', 'outro', 'não gostei') $$),
  'CANCELLATION_NOT_ALLOWED',
  'dono não cancela serviço aguardando confirmação (confirma ou abre disputa)'
);

-- ========== quem vê o registro de cancelamento ==========
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.cancelamentos where bico_id = 'b0000000-0000-0000-0000-000000000003'),
  1,
  'prestador vê o cancelamento do bico em que participou'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.cancelamentos),
  0,
  'terceiro não vê motivo nem detalhes de cancelamentos alheios'
);

select throws_ok(
  $$ insert into public.cancelamentos (bico_id, cancelado_por, motivo)
     values ('b0000000-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'outro') $$,
  '42501', null,
  'ninguém grava cancelamento direto na tabela'
);

-- ========== disputas ==========
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000006', 'atribuido');
select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'nao_compareceu', 'O prestador não apareceu no horário') $$),
  'DISPUTE_NOT_ALLOWED',
  'antes do início não há disputa (o caminho é cancelar)'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');
select public.iniciar_bico('b0000000-0000-0000-0000-000000000006');
select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'outro', 'Quero atrapalhar este bico') $$),
  'NOT_JOB_PARTICIPANT',
  'usuário sem relação não abre disputa'
);

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'servico_nao_realizado', 'curto') $$),
  'DISPUTE_DESCRIPTION_REQUIRED',
  'disputa exige descrição'
);

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'vinganca', 'Descrição longa o bastante') $$),
  'INVALID_DISPUTE_REASON',
  'motivo de disputa fora da lista é recusado'
);

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'servico_diferente_do_combinado', 'Pintou só metade do muro combinado') $$),
  'OK',
  'dono abre disputa com o serviço em andamento'
);

select is(
  (select status from public.bicos where id = 'b0000000-0000-0000-0000-000000000006'),
  'em_disputa',
  'bico fica em disputa'
);

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000006', 'outro', 'Segunda disputa sobre o mesmo bico') $$),
  'DISPUTE_ALREADY_OPEN',
  'uma disputa ativa por bico'
);

select is(
  testes_seguranca.codigo_erro($$ select public.confirmar_conclusao_bico('b0000000-0000-0000-0000-000000000006') $$),
  'JOB_NOT_AWAITING_CONFIRMATION',
  'bico em disputa não é concluído pelo dono'
);

select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.cancelar_bico('b0000000-0000-0000-0000-000000000006', 'outro', 'vou sair da disputa') $$),
  'CANCELLATION_NOT_ALLOWED',
  'bico em disputa não é cancelado pelas partes'
);

select is(
  (select count(*)::int from public.disputas where bico_id = 'b0000000-0000-0000-0000-000000000006'),
  1,
  'a outra parte vê a disputa'
);

select throws_ok(
  $$ update public.disputas set status = 'resolvida' where bico_id = 'b0000000-0000-0000-0000-000000000006' $$,
  '42501', null,
  'participante não resolve a disputa por UPDATE'
);

select is(
  testes_seguranca.codigo_erro($$
    select public.resolver_disputa(d.id, 'concluido', 'Resolvido a meu favor')
    from public.disputas d where d.bico_id = 'b0000000-0000-0000-0000-000000000006' $$),
  '42501',
  'usuário comum não chama a RPC de moderação'
);

select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.disputas),
  0,
  'terceiro não vê disputas alheias'
);

select throws_ok(
  $$ insert into public.disputas (bico_id, aberta_por, motivo, descricao)
     values ('b0000000-0000-0000-0000-000000000006', '33333333-3333-3333-3333-333333333333', 'outro', 'Tentando abrir por fora') $$,
  '42501', null,
  'ninguém grava disputa direto na tabela'
);

-- ========== moderação (service_role) ==========
select testes_seguranca.entrar_como_servico();

select is(
  testes_seguranca.codigo_erro($$
    select public.resolver_disputa(d.id, 'concluido', 'Serviço aceito após conversa com as partes')
    from public.disputas d where d.bico_id = 'b0000000-0000-0000-0000-000000000006' $$),
  'OK',
  'moderação resolve a disputa'
);

select is(
  (select b.status || '/' || d.status || '/' || d.resultado || '/' || (b.concluido_em is not null)::text
   from public.bicos b join public.disputas d on d.bico_id = b.id
   where b.id = 'b0000000-0000-0000-0000-000000000006'),
  'concluido/resolvida/concluido/true',
  'resolver como concluído conclui o bico e fecha a disputa'
);

select is(
  testes_seguranca.codigo_erro($$
    select public.resolver_disputa(d.id, 'cancelado', 'Mudança de ideia')
    from public.disputas d where d.bico_id = 'b0000000-0000-0000-0000-000000000006' $$),
  'DISPUTE_ALREADY_RESOLVED',
  'disputa resolvida não é resolvida de novo'
);

-- Disputa aberta pelo prestador enquanto aguarda confirmação, resolvida
-- como cancelada.
select testes_seguranca.preparar_bico('b0000000-0000-0000-0000-000000000007', 'aguardando_confirmacao');
select testes_seguranca.entrar_como('22222222-2222-2222-2222-222222222222');

select is(
  testes_seguranca.codigo_erro($$ select public.abrir_disputa('b0000000-0000-0000-0000-000000000007', 'problema_de_pagamento', 'O contratante não pagou nem confirma') $$),
  'OK',
  'prestador abre disputa quando o dono não confirma'
);

select testes_seguranca.entrar_como_servico();
select public.resolver_disputa(d.id, 'cancelado', 'Sem provas do serviço') from public.disputas d
where d.bico_id = 'b0000000-0000-0000-0000-000000000007';
select testes_seguranca.sair();

select is(
  (select b.status || '/' || coalesce(c.cancelado_por::text, 'moderacao')
   from public.bicos b join public.cancelamentos c on c.bico_id = b.id
   where b.id = 'b0000000-0000-0000-0000-000000000007'),
  'cancelado/moderacao',
  'resolver como cancelado registra o cancelamento pela moderação'
);

select * from finish();
rollback;
