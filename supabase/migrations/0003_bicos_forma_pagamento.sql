-- Forma de pagamento do bico (dinheiro ou pix)
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

alter table public.bicos
  add column forma_pagamento text not null default 'dinheiro' check (forma_pagamento in ('dinheiro', 'pix'));
