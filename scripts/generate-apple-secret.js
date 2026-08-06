/**
 * Gera o "Secret Key (for OAuth)" que o Supabase pede no provider Apple.
 * Não precisa instalar nada — só Node.js (usa o módulo `crypto` embutido).
 *
 * Uso:
 *   node generate-apple-secret.js <caminho-do-arquivo.p8> <TEAM_ID> <KEY_ID> <CLIENT_ID>
 *
 * Exemplo (com os dados do seu projeto):
 *   node generate-apple-secret.js "C:\Users\nagib\Downloads\AuthKey_ABC123DEFG.p8" C2KT64ST28 ABC123DEFG com.nagibneto.nextepisode
 *
 * Onde conseguir cada valor:
 *   - arquivo .p8: Apple Developer → Certificates, Identifiers & Profiles → Keys →
 *     criar uma chave nova com "Sign in with Apple" marcado, associada ao App ID
 *     com.nagibneto.nextepisode. Baixa uma vez só (a Apple não deixa baixar de novo).
 *   - TEAM_ID: já sabemos que é C2KT64ST28 (apareceu no `eas device:list`).
 *   - KEY_ID: aparece na tela de confirmação depois de criar a chave (10 caracteres).
 *   - CLIENT_ID: com.nagibneto.nextepisode (o mesmo que já está no campo "Client IDs"
 *     do Supabase).
 *
 * O token gerado vale 180 dias (o máximo que a Apple permite). Depois disso precisa
 * gerar de novo e atualizar no Supabase — é o aviso amarelo que já aparece lá.
 */

const crypto = require('crypto');
const fs = require('fs');

const [, , keyPath, teamId, keyId, clientId] = process.argv;

if (!keyPath || !teamId || !keyId || !clientId) {
  console.error('Uso: node generate-apple-secret.js <arquivo.p8> <TEAM_ID> <KEY_ID> <CLIENT_ID>');
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const privateKey = fs.readFileSync(keyPath, 'utf8');

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: now + 180 * 24 * 60 * 60, // 180 dias, o máximo aceito pela Apple
  aud: 'https://appleid.apple.com',
  sub: clientId,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

const signature = crypto
  .sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

console.log(`${signingInput}.${signature}`);
