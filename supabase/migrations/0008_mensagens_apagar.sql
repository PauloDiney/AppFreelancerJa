-- Substituído: apagar mensagem individual virou ocultar a conversa inteira
-- (ver 0009_conversas_ocultar.sql). Isso aqui só desfaz a policy anterior,
-- caso você já tenha rodado a versão antiga deste arquivo.
-- Cole este arquivo inteiro no SQL Editor do Supabase Studio e rode.

drop policy if exists "Remetente apaga a própria mensagem em bico concluído" on public.mensagens;
