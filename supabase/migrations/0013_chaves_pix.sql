-- Chaves Pix do usuário (tela "Métodos de pagamento" → "Para receber")
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

create table public.chaves_pix (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  valor text not null,
  banco_nome text,
  principal boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table public.chaves_pix enable row level security;

create policy "Usuário vê as próprias chaves Pix"
  on public.chaves_pix for select
  to authenticated
  using (auth.uid() = usuario_id);

create policy "Usuário cadastra a própria chave Pix"
  on public.chaves_pix for insert
  to authenticated
  with check (auth.uid() = usuario_id);

create policy "Usuário edita a própria chave Pix"
  on public.chaves_pix for update
  to authenticated
  using (auth.uid() = usuario_id);

create policy "Usuário exclui a própria chave Pix"
  on public.chaves_pix for delete
  to authenticated
  using (auth.uid() = usuario_id);

-- Só pode existir uma chave "principal" por usuário — índice único parcial
-- (não uma constraint comum, porque precisa permitir várias linhas com
-- principal = false).
create unique index chaves_pix_uma_principal on public.chaves_pix (usuario_id) where principal;

-- A primeira chave cadastrada vira principal automaticamente, mesmo que o
-- cliente não mande principal=true — assim nunca existe usuário com chave(s)
-- cadastrada(s) e nenhuma principal.
create function public.chaves_pix_antes_inserir()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.chaves_pix where usuario_id = new.usuario_id and principal) then
    new.principal := true;
  end if;
  return new;
end;
$$;

create trigger chaves_pix_antes_inserir
  before insert on public.chaves_pix
  for each row execute function public.chaves_pix_antes_inserir();

-- Se a chave excluída era a principal e sobraram outras, promove a mais
-- antiga — pelo mesmo motivo do trigger de insert.
create function public.chaves_pix_apos_excluir()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.principal and not exists (select 1 from public.chaves_pix where usuario_id = old.usuario_id and principal) then
    update public.chaves_pix
    set principal = true
    where id = (
      select id from public.chaves_pix
      where usuario_id = old.usuario_id
      order by criado_em asc
      limit 1
    );
  end if;
  return old;
end;
$$;

create trigger chaves_pix_apos_excluir
  after delete on public.chaves_pix
  for each row execute function public.chaves_pix_apos_excluir();

-- Troca a chave principal do usuário logado numa transação só (limpa a
-- antiga e marca a nova), pra nunca violar o índice único acima nem passar
-- por um estado intermediário sem nenhuma principal.
create or replace function public.definir_chave_pix_principal(p_chave_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update public.chaves_pix set principal = false where usuario_id = auth.uid() and principal;
  update public.chaves_pix set principal = true where id = p_chave_id and usuario_id = auth.uid();
end;
$$;
