-- Corrige os itens CRÍTICOS e ALTOS do banco apontados na auditoria de
-- segurança (docs/ARCHITECTURE_SECURITY_AUDIT.md):
--  C2) bicos aceitava status/candidato_selecionado_id/criado_em vindos do
--      cliente no INSERT → qualquer conta forjava um bico "concluído" com a
--      vítima como prestadora e deixava avaliação 1★ nela, abria conversa com
--      quem quisesse e fixava bico no topo do feed. O UPDATE ainda deixava
--      escolher quem retirou a candidatura, ou o próprio dono.
--  H1) bicos_proximos devolvia a distância exata e aceitava raio de 1 metro:
--      três chamadas recuperavam a coordenada do bico com erro de 0 m.
--  H2) a service_role key ficava num setting do banco (app.settings.*),
--      legível por qualquer sessão — inclusive a de authenticated.
--  H3) o trigger de push chamava extensions.net_http_post, que não existe:
--      com os settings da 0017 configurados, mandar mensagem e se candidatar
--      falhavam com erro 42883.
--  C1) (parte do banco) o push passa a se autenticar na Edge Function com um
--      segredo dedicado, guardado no Vault — nunca mais a service_role.
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode. Depois
-- siga "Configuração manual" no documento da auditoria (Vault + deploy).

-- ========== C2) bico nasce sempre "aberto", sem prestador, com data do servidor ==========
-- validar_transicao_bico (0010/0015) só existe BEFORE UPDATE, e a policy de
-- INSERT só confere criado_por. Então dava pra pular a máquina de estados
-- inteira já no insert:
--
--   insert into bicos (criado_por, titulo, status, candidato_selecionado_id)
--   values ('<eu>', 'x', 'concluido', '<vítima>');
--   insert into avaliacoes (... avaliado_id = '<vítima>', nota = 1 ...);
--
-- A policy de avaliacoes (0015) confere "bico concluído + par dono/prestador"
-- e aprovava; a de conversas (0010) confere o mesmo par e aprovava o DM.
-- Trigger (e não policy) pelo mesmo motivo da 0015: a regra vale pra qualquer
-- caminho de escrita. As datas são sobrescritas em silêncio porque o app
-- nunca as envia — só quem forja manda criado_em.
create or replace function public.validar_insercao_bico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from 'aberto' then
    raise exception 'Um bico novo sempre começa como "aberto".';
  end if;

  if new.candidato_selecionado_id is not null then
    raise exception 'O prestador só pode ser escolhido entre os candidatos, depois da publicação.';
  end if;

  new.criado_em := now();
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists bicos_validar_insercao on public.bicos;

create trigger bicos_validar_insercao
  before insert on public.bicos
  for each row execute function public.validar_insercao_bico();

-- No UPDATE, três brechas do mesmo item:
--  - criado_em era regravável (o feed ordena por ele: bastava um update pra
--    fixar o bico no topo depois de criá-lo normalmente);
--  - o candidato escolhido só precisava TER uma candidatura, em qualquer
--    status — dava pra escolher quem retirou ou foi recusado e avaliá-lo;
--  - o dono podia se candidatar e escolher a si mesmo.
-- escolher_candidato() marca a candidatura como 'aceita' antes de atualizar o
-- bico, por isso 'aceita' continua valendo junto com 'pendente'.
create or replace function public.validar_transicao_bico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.criado_por is distinct from old.criado_por or new.criado_em is distinct from old.criado_em then
    raise exception 'Autor e data de publicação do bico não podem ser alterados.';
  end if;

  if old.status <> 'aberto' and (
    new.valor_oferecido is distinct from old.valor_oferecido
    or new.forma_pagamento is distinct from old.forma_pagamento
  ) then
    raise exception 'Não é possível alterar valor ou forma de pagamento depois que o bico sai de "aberto".';
  end if;

  if new.status <> old.status and not (
    (old.status = 'aberto' and new.status in ('em_andamento', 'cancelado'))
    or (old.status = 'em_andamento' and new.status in ('concluido', 'cancelado'))
  ) then
    raise exception 'Transição de status inválida: % -> %', old.status, new.status;
  end if;

  if new.candidato_selecionado_id is distinct from old.candidato_selecionado_id then
    if old.candidato_selecionado_id is not null then
      raise exception 'O prestador escolhido não pode ser trocado.';
    end if;

    if new.candidato_selecionado_id = new.criado_por then
      raise exception 'Você não pode ser o prestador do seu próprio bico.';
    end if;

    if new.candidato_selecionado_id is not null and not exists (
      select 1 from public.candidaturas c
      where c.bico_id = new.id
        and c.candidato_id = new.candidato_selecionado_id
        and c.status in ('pendente', 'aceita')
    ) then
      raise exception 'Só é possível escolher alguém com candidatura ativa neste bico.';
    end if;
  end if;

  return new;
end;
$$;

-- ========== H1) bicos_proximos deixa de ser oráculo de localização ==========
-- A 0015 escondeu a coluna localizacao, mas a função (security definer)
-- continuava calculando tudo sobre o ponto exato: a distância saía com
-- precisão de centímetros e o filtro aceitava raio de 1 m. Com três chamadas
-- a trilateração devolve a coordenada real — que muitas vezes é a casa de
-- quem publicou, contrariando o que criar-bico.tsx promete ao pedir o GPS.
--
-- Agora TUDO (filtro, distância e ordem) usa o ponto arredondado para uma
-- grade de 0,01° (~1,1 km): mesmo um atacante perfeito só chega ao nó da
-- grade, nunca ao endereço. A distância sai arredondada em 100 m, o raio fica
-- entre 1 e 50 km e o resultado é limitado a 100 linhas (antes um raio
-- gigante varria a tabela inteira). Mesma assinatura e mesmas colunas de
-- retorno: nenhuma tela usa esta RPC ainda, e quando usar nada muda no contrato.
create or replace function public.bicos_proximos(
  lat double precision,
  lng double precision,
  raio_metros integer default 10000
)
returns table (
  id uuid,
  criado_por uuid,
  categoria_id integer,
  titulo text,
  descricao text,
  endereco_texto text,
  valor_oferecido numeric,
  forma_pagamento text,
  data_hora_desejada timestamptz,
  status text,
  criado_em timestamptz,
  distancia_metros double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with origem as (
    select
      extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326)::extensions.geography as ponto,
      least(greatest(coalesce(raio_metros, 10000), 1000), 50000) as raio
    where lat between -90 and 90
      and lng between -180 and 180
  ),
  aproximados as (
    select
      b.id, b.criado_por, b.categoria_id, b.titulo, b.descricao, b.endereco_texto,
      b.valor_oferecido, b.forma_pagamento, b.data_hora_desejada, b.status, b.criado_em,
      extensions.ST_SnapToGrid(b.localizacao::extensions.geometry, 0.01)::extensions.geography as ponto
    from public.bicos b
    where b.status = 'aberto'
      and b.localizacao is not null
  )
  select
    a.id, a.criado_por, a.categoria_id, a.titulo, a.descricao, a.endereco_texto,
    a.valor_oferecido, a.forma_pagamento, a.data_hora_desejada, a.status, a.criado_em,
    round(extensions.ST_Distance(a.ponto, o.ponto) / 100) * 100 as distancia_metros
  from aproximados a
  cross join origem o
  where extensions.ST_DWithin(a.ponto, o.ponto, o.raio)
  order by distancia_metros, a.criado_em desc
  limit 100;
$$;

revoke execute on function public.bicos_proximos(double precision, double precision, integer) from public, anon;
grant execute on function public.bicos_proximos(double precision, double precision, integer) to authenticated;

-- ========== H2/H3/C1) push: segredo dedicado no Vault, pg_net correto, nunca derruba o insert ==========
-- Três problemas na notificar_push da 0017:
--  - H3: extensions.net_http_post não existe (o pg_net fica no schema "net").
--    Com os settings configurados, o erro subia pelo trigger AFTER INSERT e
--    desfazia o INSERT da mensagem/candidatura. O teste "is null" também não
--    pegava setting vazio ('').
--  - H2: a service_role key morava em "app.settings.service_role_key", um
--    setting do banco que qualquer sessão lê com current_setting() — inclusive
--    authenticated. Essa chave ignora RLS e administra o Auth.
--  - C1: a Edge Function só era protegida pelo verify_jwt, que aceita qualquer
--    JWT válido, inclusive a chave anon (pública, vai no app).
-- Agora o banco guarda só um segredo que serve exclusivamente pra chamar a
-- enviar-push (PUSH_WEBHOOK_SECRET na função, "push_webhook_secret" no Vault),
-- e qualquer falha do push vira WARNING no log em vez de erro no INSERT.
-- Sem os dois segredos no Vault, simplesmente não envia (igual antes).
create or replace function public.notificar_push(p_usuario_id uuid, p_titulo text, p_corpo text, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_segredo text;
begin
  begin
    select nullif(trim(s.decrypted_secret), '') into v_url
    from vault.decrypted_secrets s
    where s.name = 'push_project_url'
    limit 1;

    select nullif(s.decrypted_secret, '') into v_segredo
    from vault.decrypted_secrets s
    where s.name = 'push_webhook_secret'
    limit 1;
  exception when others then
    raise warning 'notificar_push: Vault indisponível (%), push não enviado.', sqlstate;
    return;
  end;

  if v_url is null or v_segredo is null then
    return; -- segredos não configurados: segue sem notificar
  end if;

  begin
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/enviar-push',
      body := jsonb_build_object(
        'usuario_id', p_usuario_id,
        'titulo', p_titulo,
        'corpo', p_corpo,
        'dados', coalesce(p_dados, '{}'::jsonb)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', v_segredo
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'notificar_push: push não enfileirado (%: %).', sqlstate, sqlerrm;
  end;
end;
$$;

revoke execute on function public.notificar_push(uuid, text, text, jsonb) from public, anon, authenticated;

-- Tira a service_role key do setting do banco (a 0017 mandava gravar lá).
-- Melhor esforço: se o role que roda a migration não puder alterar o banco,
-- só avisa — e o passo manual equivalente está no documento da auditoria.
-- Remover NÃO basta se ela já foi gravada: a chave precisa ser rotacionada.
do $$
begin
  execute format('alter database %I reset "app.settings.service_role_key"', current_database());
exception when others then
  raise notice 'Remova manualmente: alter database % reset "app.settings.service_role_key"; (%)', current_database(), sqlerrm;
end
$$;
