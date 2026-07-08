// Permite importar arquivos .css (usado por src/global.css no web).
// O Expo gera declarações equivalentes em expo-env.d.ts ao rodar `expo start`,
// mas este arquivo garante que `tsc --noEmit` funcione antes disso.
declare module '*.css';
