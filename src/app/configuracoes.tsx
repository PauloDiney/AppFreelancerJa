import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/services/supabaseClient';
import { PreferenciaTema, usePreferenciaTema } from '@/stores/theme-store';

const TEMAS: { variante: PreferenciaTema; label: string }[] = [
  { variante: 'claro', label: 'Claro' },
  { variante: 'escuro', label: 'Escuro' },
  { variante: 'automatico', label: 'Automático' },
];

export default function ConfiguracoesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { preferencia, definirPreferencia } = usePreferenciaTema();

  // Estado só local, não persiste em lugar nenhum e não tem efeito real
  // ainda — "Notificações", "Identidade verificada", "Alterar senha",
  // "Verificação em duas etapas" e "Denúncias e bloqueios" são placeholders
  // de UI. Só a preferência de tema (acima) é de verdade, via theme-store.
  const [notificacoesAtivas, setNotificacoesAtivas] = useState(true);
  const [duasEtapas, setDuasEtapas] = useState(false);

  const sair = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <Pressable style={[styles.backButton, { backgroundColor: theme.background }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </Pressable>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Configurações
        </ThemedText>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            APARÊNCIA
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">Tema</ThemedText>
            <View style={styles.temasRow}>
              {TEMAS.map((item) => (
                <TemaTile
                  key={item.variante}
                  variante={item.variante}
                  label={item.label}
                  selecionado={preferencia === item.variante}
                  onPress={() => definirPreferencia(item.variante)}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            CONTA
          </ThemedText>
          <ConfigRow icone="person-circle-outline" cor="primary" label="Dados pessoais" />
          <ConfigRow icone="cash-outline" cor="statusPending" label="Métodos de pagamento" />
          <ConfigRow
            icone="notifications-outline"
            cor="statusSuccess"
            label="Notificações"
            toggle
            valor={notificacoesAtivas}
            aoAlternar={setNotificacoesAtivas}
          />
        </View>

        <View style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">
            SEGURANÇA
          </ThemedText>

          <View style={[styles.row, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
            <View style={[styles.rowIcone, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="checkmark" size={18} color={theme.statusSuccess} />
            </View>
            <View style={styles.flex1}>
              <ThemedText type="default">Identidade verificada</ThemedText>
              <ThemedText type="small" themeColor="statusSuccess">
                ✓ Documento confirmado
              </ThemedText>
            </View>
          </View>

          <ConfigRow icone="lock-closed-outline" cor="textSecondary" label="Alterar senha" />
          <ConfigRow
            icone="shield-checkmark-outline"
            cor="textSecondary"
            label="Verificação em duas etapas"
            toggle
            valor={duasEtapas}
            aoAlternar={setDuasEtapas}
          />
          <ConfigRow icone="add-circle-outline" cor="statusDanger" label="Denúncias e bloqueios" labelColor="statusDanger" />
        </View>

        <Pressable style={styles.sairButton} onPress={sair}>
          <ThemedText type="smallBold" themeColor="statusDanger">
            Sair da conta
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary" style={styles.versao}>
          Tô Dentro · versão 1.0.0
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function TemaTile({
  variante,
  label,
  selecionado,
  onPress,
}: {
  variante: PreferenciaTema;
  label: string;
  selecionado: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable style={styles.temaTile} onPress={onPress}>
      <View style={[styles.previewWrapper, selecionado && { borderWidth: 2, borderColor: theme.primary }]}>
        <TemaPreview variante={variante} />
        {selecionado && (
          <View style={[styles.checkBadge, { backgroundColor: theme.primary }]}>
            <Ionicons name="checkmark" size={10} color={theme.background} />
          </View>
        )}
      </View>
      <ThemedText type="small" themeColor={selecionado ? 'primary' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function TemaPreview({ variante }: { variante: PreferenciaTema }) {
  if (variante === 'automatico') {
    return (
      <View style={[styles.previewBox, styles.previewBoxDividido]}>
        <View style={[styles.previewMetade, { backgroundColor: '#FFFFFF' }]}>
          <View style={[styles.previewBarra, { backgroundColor: '#1E5FCC' }]} />
        </View>
        <View style={[styles.previewMetade, { backgroundColor: '#0F172A' }]}>
          <View style={[styles.previewLinha, { backgroundColor: '#28344A' }]} />
        </View>
      </View>
    );
  }

  const claro = variante === 'claro';
  const bg = claro ? '#FFFFFF' : '#0F172A';
  const linha = claro ? '#E8DFC9' : '#28344A';

  return (
    <View style={[styles.previewBox, { backgroundColor: bg }]}>
      <View style={[styles.previewBarra, { backgroundColor: '#1E5FCC' }]} />
      <View style={[styles.previewLinha, { backgroundColor: linha }]} />
      <View style={[styles.previewLinha, styles.previewLinhaCurta, { backgroundColor: linha }]} />
    </View>
  );
}

function ConfigRow({
  icone,
  cor,
  label,
  labelColor,
  toggle,
  valor,
  aoAlternar,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  cor: ThemeColor;
  label: string;
  labelColor?: ThemeColor;
  toggle?: boolean;
  valor?: boolean;
  aoAlternar?: (valor: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}>
      <View style={[styles.rowIcone, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name={icone} size={18} color={theme[cor]} />
      </View>
      <ThemedText type="default" themeColor={labelColor} style={styles.flex1}>
        {label}
      </ThemedText>
      {toggle ? (
        <Switch value={valor} onValueChange={aoAlternar} trackColor={{ true: theme.primary }} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
  },
  body: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  temasRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  temaTile: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  previewWrapper: {
    borderRadius: Spacing.two,
    padding: Spacing.half,
  },
  previewBox: {
    width: 96,
    height: 64,
    borderRadius: Spacing.one,
    padding: Spacing.two,
    gap: Spacing.one,
    overflow: 'hidden',
  },
  previewBoxDividido: {
    flexDirection: 'row',
    padding: 0,
    gap: 0,
  },
  previewMetade: {
    flex: 1,
    padding: Spacing.two,
    justifyContent: 'center',
  },
  previewBarra: {
    height: 6,
    width: '60%',
    borderRadius: 3,
  },
  previewLinha: {
    height: 4,
    width: '80%',
    borderRadius: 2,
  },
  previewLinhaCurta: {
    width: '50%',
  },
  checkBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  rowIcone: {
    width: 32,
    height: 32,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: {
    flex: 1,
  },
  sairButton: {
    alignItems: 'center',
    paddingTop: Spacing.three,
  },
  versao: {
    textAlign: 'center',
  },
});
