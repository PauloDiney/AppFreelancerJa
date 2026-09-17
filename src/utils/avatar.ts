import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/services/supabaseClient';

// Fluxo de trocar a foto de perfil, usado por /editar-perfil e /dados-pessoais
// (as duas telas tinham uma cópia idêntica disso). Devolve a nova URL pública,
// ou null se o usuário cancelou o seletor.
//
// A extensão sai de uma allowlist e não mais do mimeType que o dispositivo
// manda: antes era `mimeType.split('/')[1]`, que aceitava qualquer coisa —
// "image/svg+xml" virava o arquivo "avatar.svg+xml", e SVG servido inline de
// um bucket público é vetor de XSS no build web. O bucket também passou a
// recusar esses tipos no servidor (migration 0015), isso aqui é a primeira
// barreira, pra dar erro antes de subir 5 MB à toa.
const TIPOS_ACEITOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Erros cuja mensagem já foi escrita pra aparecer na tela — mesma convenção do
// código P0001 em utils/erros.ts, que passa a mensagem do banco direto pro
// usuário em vez de traduzir. As telas mostram erro.message sem passar por
// mensagemErro(), que engoliria o texto e devolveria o genérico.
export class ErroAvatar extends Error {}

export async function escolherEEnviarAvatar(usuarioId: string): Promise<string | null> {
  const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (permissao.status !== 'granted') {
    throw new ErroAvatar('Precisamos de acesso às suas fotos para trocar o avatar.');
  }

  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (resultado.canceled) return null;

  const asset = resultado.assets[0];
  const tipo = asset.mimeType ?? 'image/jpeg';
  const extensao = TIPOS_ACEITOS[tipo];
  if (!extensao) {
    throw new ErroAvatar('Formato de imagem não suportado. Use JPG, PNG ou WebP.');
  }

  const caminho = `${usuarioId}/avatar.${extensao}`;

  const resposta = await fetch(asset.uri);
  const arrayBuffer = await resposta.arrayBuffer();

  const { error: erroUpload } = await supabase.storage
    .from('avatars')
    .upload(caminho, arrayBuffer, { contentType: tipo, upsert: true });
  if (erroUpload) throw erroUpload;

  const { data: urlPublica } = supabase.storage.from('avatars').getPublicUrl(caminho);
  // ?t= força o cache do expo-image a buscar de novo: o caminho é sempre o
  // mesmo (upsert), então sem isso a foto antiga continuaria aparecendo.
  const novaUrl = `${urlPublica.publicUrl}?t=${Date.now()}`;

  const { error: erroPerfil } = await supabase.from('profiles').update({ foto_url: novaUrl }).eq('id', usuarioId);
  if (erroPerfil) throw erroPerfil;

  return novaUrl;
}
