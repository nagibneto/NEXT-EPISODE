# Atualização OTA (EAS Update)

Só funciona para mudanças em JS/TS/assets (sem plugin novo, sem dependência
nativa nova). Mudança nativa precisa de build + envio pra loja (`eas build`).

## Publicar (Android + iOS de uma vez)

```bash
eas update --branch production --message "Descrição da mudança"
```

## Publicar só para uma plataforma

```bash
eas update --branch production --platform android --message "Descrição da mudança"
eas update --branch production --platform ios --message "Descrição da mudança"
```

## Outros canais (antes de ir pra produção)

```bash
eas update --branch preview --message "Descrição da mudança"
eas update --branch development --message "Descrição da mudança"
```

## Conferir o que está publicado

```bash
eas channel:list
eas update:list --branch production
```

## Desfazer (voltar pro update anterior)

```bash
eas update:republish --group <GROUP_ID_ANTERIOR>
```
