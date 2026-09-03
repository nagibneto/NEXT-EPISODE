// `react-native-share` e `react-native-view-shot` são módulos nativos e o
// require dos specs quebra o bundle web (usado só pelo `eas update` na hora de
// exportar). O cartão de conquista só existe no app nativo, então no web o
// componente é um no-op — o Metro resolve este arquivo antes do .tsx irmão.
type Props = {
  visible: boolean;
  onClose: () => void;
  imageUrl: string | null;
  badgeLabel: string;
  title: string;
  subtitle?: string;
};

export function ShareWatchedSheet(props: Props) {
  void props;
  return null;
}
