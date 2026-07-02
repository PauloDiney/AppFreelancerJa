-- Bucket público para fotos de perfil + policies (cada usuário só escreve na própria pasta)
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatares são visíveis publicamente"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Usuário envia o próprio avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Usuário atualiza o próprio avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Usuário remove o próprio avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
