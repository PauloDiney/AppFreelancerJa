-- Concorrência de verdade (0019): duas sessões ao mesmo tempo, via dblink.
--
-- As outras suítes rodam numa sessão só e não conseguem provar que duas
-- aceitações simultâneas nunca escolhem dois prestadores. Aqui a sessão A
-- aceita uma candidatura e segura a transação aberta; a sessão B tenta aceitar
-- outra no mesmo bico. O teste exige que B FIQUE ESPERANDO a trava da linha do
-- bico e, quando A confirma, seja recusada. Depois repete com uma candidatura
-- chegando no meio da aceitação.
--
-- As sessões paralelas não enxergam a transação deste teste, então os dados
-- são gravados de verdade (ids aleatórios) e apagados no fim.
--
-- Conexão: por padrão o Postgres do `supabase start` (senha local
-- "postgres"). Em outro ambiente, antes de rodar:
--   set testes.dblink_conexao = 'host=... port=... dbname=... user=... password=...';
-- Sem conexão possível, os testes aparecem como "skip" — nunca como aprovados.
begin;
create extension if not exists pgtap with schema extensions;
-- dblink existe no Supabase; fora dele, o teste vira "skip" em vez de erro.
do $$
begin
  create extension if not exists dblink with schema extensions;
exception when others then
  raise notice 'dblink indisponível: %', sqlerrm;
end
$$;
select plan(6);

create schema testes_concorrencia;

create function testes_concorrencia.conexao() returns text
language sql as $$
  select coalesce(
    nullif(current_setting('testes.dblink_conexao', true), ''),
    format(
      'host=%s port=%s dbname=%s user=postgres password=postgres',
      coalesce(host(inet_server_addr()), '127.0.0.1'),
      coalesce(inet_server_port(), 5432),
      current_database()
    )
  );
$$;

-- Espera (até ~3 s) a sessão B terminar e devolve a mensagem de erro dela,
-- ou 'OK' se não deu erro.
create function testes_concorrencia.resultado_de_b() returns text
language plpgsql as $$
declare
  v_tentativas integer := 0;
begin
  while extensions.dblink_is_busy('conc_b') = 1 and v_tentativas < 30 loop
    perform pg_sleep(0.1);
    v_tentativas := v_tentativas + 1;
  end loop;
  perform * from extensions.dblink_get_result('conc_b', false) as r(valor text);
  perform * from extensions.dblink_get_result('conc_b', false) as r(valor text);
  return extensions.dblink_error_message('conc_b');
end;
$$;

create function testes_concorrencia.executar() returns setof text
language plpgsql as $$
declare
  v_dono uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_c3 uuid := gen_random_uuid();
  v_bico uuid := gen_random_uuid();
  v_bico2 uuid := gen_random_uuid();
  v_cand1 uuid;
  v_cand2 uuid;
  v_cand_bico2 uuid;
  v_b_esperou boolean;
  v_erro_b text;
  v_b_esperou_2 boolean;
  v_erro_b_2 text;
  v_falha text;
begin
  if to_regprocedure('extensions.dblink_connect(text, text)') is null then
    return next skip('extensão dblink indisponível neste banco', 6);
    return;
  end if;

  begin
    perform extensions.dblink_connect('conc_a', testes_concorrencia.conexao());
    perform extensions.dblink_connect('conc_b', testes_concorrencia.conexao());
  exception when others then
    return next skip('sem conexão paralela via dblink (' || sqlerrm || ')', 6);
    return;
  end;

  begin
    -- Dados gravados pela sessão A (autocommit). dblink_exec só aceita
    -- comandos cujo último resultado não tem linhas: cada bloco abaixo
    -- termina em INSERT/SET/DO.
    perform extensions.dblink_exec('conc_a', format(
      $sql$
        insert into auth.users (id, email) values
          (%1$L, %1$L || '@concorrencia.teste'), (%2$L, %2$L || '@concorrencia.teste'),
          (%3$L, %3$L || '@concorrencia.teste'), (%4$L, %4$L || '@concorrencia.teste');
        insert into public.bicos (id, criado_por, titulo) values
          (%5$L, %1$L, 'Concorrência: duas aceitações'),
          (%6$L, %1$L, 'Concorrência: candidatura x aceitação');
        insert into public.candidaturas (bico_id, candidato_id) values
          (%5$L, %2$L), (%5$L, %3$L), (%6$L, %2$L);
      $sql$,
      v_dono, v_c1, v_c2, v_c3, v_bico, v_bico2
    ));

    select id into v_cand1 from public.candidaturas where bico_id = v_bico and candidato_id = v_c1;
    select id into v_cand2 from public.candidaturas where bico_id = v_bico and candidato_id = v_c2;
    select id into v_cand_bico2 from public.candidaturas where bico_id = v_bico2 and candidato_id = v_c1;

    -- ===== corrida 1: duas aceitações no mesmo bico =====
    -- A aceita e NÃO confirma: segura a trava da linha do bico.
    perform extensions.dblink_exec('conc_a', format(
      $sql$
        begin;
        set local "request.jwt.claims" to %1$L;
        set local role authenticated;
        do $rpc$ begin perform public.aceitar_candidatura(%2$L); end $rpc$;
      $sql$,
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, v_cand1
    ));

    -- B, como o mesmo dono (toque duplo em outro candidato), tenta aceitar.
    perform extensions.dblink_exec('conc_b', format(
      $sql$
        set "request.jwt.claims" to %1$L;
        set role authenticated;
      $sql$,
      json_build_object('sub', v_dono, 'role', 'authenticated')::text
    ));
    perform extensions.dblink_send_query('conc_b', format('select public.aceitar_candidatura(%L)', v_cand2));

    perform pg_sleep(0.5);
    v_b_esperou := extensions.dblink_is_busy('conc_b') = 1;

    perform extensions.dblink_exec('conc_a', 'commit');
    v_erro_b := testes_concorrencia.resultado_de_b();

    -- ===== corrida 2: candidatura chegando durante a aceitação =====
    perform extensions.dblink_exec('conc_a', format(
      $sql$
        begin;
        set local "request.jwt.claims" to %1$L;
        set local role authenticated;
        do $rpc$ begin perform public.aceitar_candidatura(%2$L); end $rpc$;
      $sql$,
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, v_cand_bico2
    ));

    perform extensions.dblink_exec('conc_b', format(
      $sql$ set "request.jwt.claims" to %1$L; $sql$,
      json_build_object('sub', v_c3, 'role', 'authenticated')::text
    ));
    perform extensions.dblink_send_query('conc_b', format('select public.candidatar_se(%L)', v_bico2));

    perform pg_sleep(0.5);
    v_b_esperou_2 := extensions.dblink_is_busy('conc_b') = 1;

    perform extensions.dblink_exec('conc_a', 'commit');
    v_erro_b_2 := testes_concorrencia.resultado_de_b();
  exception when others then
    v_falha := sqlerrm;
  end;

  -- Resultados lidos antes da limpeza.
  if v_falha is not null then
    return next fail('corrida não pôde ser executada: ' || v_falha);
    return next skip('dependem da corrida acima', 5);
  else
    return next ok(v_b_esperou, 'segunda aceitação espera a primeira terminar (trava na linha do bico)');
    return next ok(
      coalesce(v_erro_b, '') like '%já tem um prestador escolhido%',
      'segunda aceitação é recusada quando a primeira confirma (' || coalesce(v_erro_b, 'sem erro') || ')'
    );
    return next is(
      (select count(*)::int from public.candidaturas where bico_id = v_bico and status = 'aceita'),
      1,
      'exatamente uma candidatura aceita depois da corrida'
    );
    return next is(
      (select candidato_selecionado_id from public.bicos where id = v_bico),
      v_c1,
      'o bico fica com o prestador da aceitação que chegou primeiro'
    );
    return next ok(v_b_esperou_2, 'candidatura concorrente espera a aceitação em curso');
    return next ok(
      coalesce(v_erro_b_2, '') like '%não está mais recebendo candidaturas%',
      'candidatura que chega durante a aceitação é recusada (' || coalesce(v_erro_b_2, 'sem erro') || ')'
    );
  end if;

  -- Limpeza dos dados gravados pelas sessões paralelas.
  begin
    perform extensions.dblink_exec('conc_a', 'rollback');
  exception when others then
    null;
  end;
  perform extensions.dblink_exec('conc_a', format(
    $sql$
      delete from public.bicos where id in (%1$L, %2$L);
      delete from auth.users where id in (%3$L, %4$L, %5$L, %6$L);
    $sql$,
    v_bico, v_bico2, v_dono, v_c1, v_c2, v_c3
  ));
  perform extensions.dblink_disconnect('conc_a');
  perform extensions.dblink_disconnect('conc_b');
end;
$$;

select * from testes_concorrencia.executar();

select * from finish();
rollback;
