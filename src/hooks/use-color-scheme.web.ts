import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// No web com renderização estática o HTML é gerado no servidor, onde não existe
// preferência de tema — então o primeiro render precisa ser 'light' nos dois
// lados, ou o React acusa divergência de hidratação.
//
// useSyncExternalStore é a forma que o React documenta pra isso: getSnapshot
// devolve true (cliente) e getServerSnapshot devolve false (servidor/primeiro
// render). A versão anterior usava useState + useEffect, que faz exatamente a
// mesma coisa às custas de um render em cascata — e é o que a regra
// react-hooks/set-state-in-effect aponta.
const inscrever = () => () => {};
const noCliente = () => true;
const noServidor = () => false;

export function useColorScheme() {
  const hidratado = useSyncExternalStore(inscrever, noCliente, noServidor);
  const colorScheme = useRNColorScheme();

  return hidratado ? colorScheme : 'light';
}
