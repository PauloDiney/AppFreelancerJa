-- Campos de "Dados pessoais" (tipo de cadastro, CPF/CNPJ, nascimento, sexo, endereço)
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

alter table public.profiles
  add column tipo_cadastro text not null default 'pessoa_fisica' check (tipo_cadastro in ('pessoa_fisica', 'empresa')),
  add column cpf text check (cpf is null or char_length(cpf) = 11),
  add column cnpj text check (cnpj is null or char_length(cnpj) = 14),
  add column data_nascimento date,
  add column sexo text check (sexo in ('masculino', 'feminino', 'outro', 'prefiro_nao_dizer')),
  add column cep text,
  add column cidade text,
  add column uf text,
  add column bairro text;

-- Dígitos guardados sem máscara (só números) — a formatação (000.000.000-00
-- etc.) é responsabilidade da tela. Único por conta, mas permite várias
-- linhas nulas (usuário ainda não cadastrou).
create unique index profiles_cpf_key on public.profiles (cpf) where cpf is not null;
create unique index profiles_cnpj_key on public.profiles (cnpj) where cnpj is not null;

-- Mesma lógica da migration 0011 pro telefone: CPF/CNPJ/nascimento/sexo/
-- endereço não entram no grant de select geral (são dados sensíveis, não
-- "perfil público"), então ficam de fora da lista de colunas liberada pra
-- authenticated e só o dono consegue lê-los, via a função abaixo.
create or replace function public.meus_dados_pessoais()
returns table (
  telefone text,
  tipo_cadastro text,
  cpf text,
  cnpj text,
  data_nascimento date,
  sexo text,
  cep text,
  cidade text,
  uf text,
  bairro text
)
language sql
stable
security definer
set search_path = public
as $$
  select telefone, tipo_cadastro, cpf, cnpj, data_nascimento, sexo, cep, cidade, uf, bairro
  from public.profiles
  where id = auth.uid();
$$;
