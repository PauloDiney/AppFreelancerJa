import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabaseClient';
import { usePreferenciaNotificacoes } from '@/stores/notificacoes-store';

// Com o app aberto o sistema não mostra nada por conta própria — quem decide é
// este handler. shouldShowAlert está deprecado nesta versão; o par correto
// agora é shouldShowBanner (o balão no topo) + shouldShowList (a central de
// notificações). Fica no escopo do módulo porque precisa estar registrado
// antes de qualquer notificação chegar, não dentro de um efeito.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function obterProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

async function registrarToken(usuarioId: string) {
  // Emulador não recebe push: o Expo não emite token e getExpoPushTokenAsync
  // lança. Sai antes em vez de estourar no log a cada abertura.
  if (!Device.isDevice) return;

  // No Android o canal precisa existir ANTES de pedir o token — sem ele o
  // prompt de permissão nem aparece no Android 13+.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Mensagens e candidaturas',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#1E5FCC',
    });
  }

  const { status: statusAtual } = await Notifications.getPermissionsAsync();
  let status = statusAtual;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  const projectId = obterProjectId();
  if (!projectId) return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  // onConflict no token (e não no usuário): a mesma pessoa pode ter vários
  // aparelhos, e o mesmo aparelho pode trocar de dono quando outra conta loga —
  // aí o token só muda de usuario_id em vez de duplicar.
  await supabase
    .from('push_tokens')
    .upsert({ usuario_id: usuarioId, token, atualizado_em: new Date().toISOString() }, { onConflict: 'token' });
}

// Apaga o token deste aparelho. Precisa rodar ENQUANTO a sessão ainda existe —
// depois do signOut a RLS de push_tokens já não deixa. Por isso o logout passa
// por encerrarSessao() em utils/sessao.ts, e não por supabase.auth.signOut()
// direto: sem isso, quem sai da conta continuaria recebendo no aparelho as
// mensagens que chegassem para ela.
export async function removerTokenPushDesteAparelho() {
  try {
    if (!Device.isDevice) return;
    const projectId = obterProjectId();
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Melhor esforço: falhar aqui não pode impedir o logout.
  }
}

// Registra o aparelho sempre que alguém loga, e reage ao toque na notificação
// abrindo a conversa ou o bico correspondente. Respeita o toggle de
// Configurações: desligado, o token é removido e nada mais chega.
export function useRegistroPush(usuarioId: string | null) {
  const router = useRouter();
  const { ativas } = usePreferenciaNotificacoes();

  useEffect(() => {
    if (!usuarioId) return;

    const acao = ativas ? registrarToken(usuarioId) : removerTokenPushDesteAparelho();
    acao.catch(() => {
      // Sem push o app funciona normalmente — não vale travar nada por isso.
    });
  }, [usuarioId, ativas]);

  useEffect(() => {
    const inscricao = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const dados = resposta.notification.request.content.data as {
        tipo?: string;
        conversa_id?: string;
        bico_id?: string;
      };

      if (dados?.tipo === 'mensagem' && dados.conversa_id) {
        router.push({ pathname: '/chat/[id]', params: { id: dados.conversa_id } });
      } else if (dados?.tipo === 'candidatura' && dados.bico_id) {
        router.push({ pathname: '/bico/[id]', params: { id: dados.bico_id } });
      }
    });

    return () => inscricao.remove();
  }, [router]);
}
