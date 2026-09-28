-- Dados sensíveis: colunas que nenhuma outra conta pode ler (0011, 0012,
-- 0015), o que o anônimo enxerga, e bicos_proximos sem vazar o GPS (0018).
-- Roda com `supabase test db` (transação com rollback no final).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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

create function testes_seguranca.entrar_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function testes_seguranca.sair() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Quantas linhas o usuário atual enxerga numa consulta. Sem privilégio
-- nenhum também conta como "zero": o que interessa é não ver dado, seja pela
-- RLS ou por um revoke futuro (ex.: tirar o grant padrão do anon).
create function testes_seguranca.linhas_visiveis(p_consulta text) returns bigint
language plpgsql as $$
declare
  v_total bigint;
begin
  execute format('select count(*) from (%s) as consulta', p_consulta) into v_total;
  return v_total;
exception when insufficient_privilege then
  return 0;
end;
$$;

grant execute on all functions in schema testes_seguranca to public;

-- 1111 dona dos dados · 3333 outra conta
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'dona@teste.dev', '{"nome_completo":"Dona"}'),
  ('33333333-3333-3333-3333-333333333333', 'curioso@teste.dev', '{"nome_completo":"Curioso"}');

select testes_seguranca.entrar_como('11111111-1111-1111-1111-111111111111');

update public.profiles
set cpf = '52998224725', telefone = '11999990000', data_nascimento = '1990-01-01', cep = '01310100'
where id = '11111111-1111-1111-1111-111111111111';

insert into public.chaves_pix (id, usuario_id, tipo, valor)
values ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'cpf', '52998224725');

insert into public.push_tokens (usuario_id, token)
values ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[teste-dona]');

-- Dois bicos na MESMA célula de 0,01° da grade, em pontos exatos ~380 m um
-- do outro, e um terceiro a ~100 km.
insert into public.bicos (id, criado_por, titulo, localizacao) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Casa A', 'POINT(-46.6558123 -23.5613456)'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Casa B', 'POINT(-46.6591000 -23.5629000)'),
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Longe', 'POINT(-47.6500000 -23.5600000)');

-- ========== colunas sensíveis de outra conta ==========
select testes_seguranca.entrar_como('33333333-3333-3333-3333-333333333333');

select throws_ok($$ select cpf from public.profiles $$, '42501', null, 'CPF de outra conta não é legível');
select throws_ok($$ select telefone from public.profiles $$, '42501', null, 'telefone de outra conta não é legível');
select throws_ok($$ select email from public.profiles $$, '42501', null, 'e-mail de outra conta não é legível');
select throws_ok($$ select data_nascimento, cep from public.profiles $$, '42501', null, 'nascimento e endereço não são legíveis');
select throws_ok($$ select localizacao from public.bicos $$, '42501', null, 'GPS exato do bico não é legível');

select is((select count(*)::int from public.meus_dados_pessoais()), 1, 'meus_dados_pessoais devolve só a linha de quem chama');
select is((select cpf from public.meus_dados_pessoais()), null, 'meus_dados_pessoais não devolve o CPF de outra conta');

select throws_ok(
  $$ update public.profiles set nota_media_como_prestador = 5 where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'usuário não edita a própria reputação'
);

select throws_ok(
  $$ update public.profiles set status_conta = 'ativo' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'usuário não edita o próprio status_conta'
);

select is((select count(*)::int from public.chaves_pix), 0, 'chaves Pix de outra conta são invisíveis');
select is((select count(*)::int from public.push_tokens), 0, 'tokens de push de outra conta são invisíveis');

select throws_ok(
  $$ select public.definir_chave_pix_principal('f0000000-0000-0000-0000-000000000001') $$,
  'P0001', null,
  'ninguém mexe na chave Pix principal de outra conta'
);

-- ========== H1: bicos_proximos não revela o ponto exato ==========
select is(
  (select count(distinct distancia_metros)::int
   from public.bicos_proximos(-23.5500, -46.6600, 50000)
   where id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002')),
  1,
  'dois bicos na mesma célula da grade devolvem a mesma distância (o ponto exato não influencia)'
);

select is(
  (select count(*)::int from public.bicos_proximos(-23.5500, -46.6600, 50000) where distancia_metros::numeric % 100 <> 0),
  0,
  'distância sai arredondada em 100 m'
);

select ok(
  (select count(*) from public.bicos_proximos(-23.5613456, -46.6558123, 1)
   where id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002')) = 2,
  'raio de 1 m vira 1 km: não serve de oráculo pra confirmar o ponto exato'
);

select is(
  (select count(*)::int from public.bicos_proximos(-23.5613456, -46.6558123, 2147483647)
   where id = 'e0000000-0000-0000-0000-000000000003'),
  0,
  'raio é limitado a 50 km'
);

select is((select count(*)::int from public.bicos_proximos(999, 999, 10000)), 0, 'coordenada inválida não devolve nada');

-- ========== anônimo (chave anon, sem login) ==========
select testes_seguranca.entrar_anon();

select throws_ok(
  $$ select * from public.bicos_proximos(-23.56, -46.66, 10000) $$,
  '42501', null,
  'anônimo não chama bicos_proximos'
);

select is(testes_seguranca.linhas_visiveis('select 1 from public.profiles'), 0::bigint, 'anônimo não lê perfis');
select is(testes_seguranca.linhas_visiveis('select 1 from public.bicos'), 0::bigint, 'anônimo não lê bicos');
select is(testes_seguranca.linhas_visiveis('select 1 from public.mensagens'), 0::bigint, 'anônimo não lê mensagens');
select is(testes_seguranca.linhas_visiveis('select * from public.meus_dados_pessoais()'), 0::bigint, 'anônimo não obtém dados pessoais pela RPC');

select testes_seguranca.sair();

select * from finish();
rollback;
