-- Adiciona email em profiles e para de exigir telefone/verificações no cadastro
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

alter table public.profiles add column email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, telefone)
  values (new.id, new.email, new.raw_user_meta_data ->> 'telefone');
  return new;
end;
$$;
