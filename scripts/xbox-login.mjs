#!/usr/bin/env node
/**
 * Login ÚNICO da conta robô do Xbox (ver GAMES.md → Xbox).
 *
 *   node scripts/xbox-login.mjs
 *
 * 1. Mostra um link de login da Microsoft (app "Next Episode Xbox" do Azure).
 * 2. Você abre no navegador, entra com a CONTA ROBÔ e aceita.
 * 3. O navegador cai numa página em branco; copie o endereço inteiro dela e
 *    cole aqui.
 * 4. O script troca o código por um refresh token, confere que ele abre o
 *    Xbox Live (mostra a gamertag do robô) e grava no .env:
 *      XBOX_CLIENT_ID=...
 *      XBOX_REFRESH_TOKEN=...
 *    O token nunca aparece na tela.
 *
 * Depois: npx supabase secrets set (comando no fim da execução).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const CLIENT_ID = process.env.XBOX_CLIENT_ID || '02c79466-8ccc-44d5-b0d2-765e55bcfd5d';
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';
const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const ENV_FILE = '.env';

function setEnvVar(content, name, value) {
  const line = `${name}=${value}`;
  const regex = new RegExp(`^${name}=.*$`, 'm');
  if (regex.test(content)) return content.replace(regex, line);
  return `${content.replace(/\s*$/, '')}\n${line}\n`;
}

async function main() {
  const authorizeUrl =
    `${AUTH_BASE}/authorize?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      // Sempre pergunta a conta: evita entrar sem querer com a conta pessoal.
      prompt: 'select_account',
    });

  console.log('\n1) Abra este link no navegador e entre com a CONTA ROBÔ (não a sua):\n');
  console.log(authorizeUrl);
  console.log(
    '\n2) Depois de aceitar, o navegador abre uma página em branco.' +
      '\n   Copie o endereço INTEIRO da barra (começa com https://login.microsoftonline.com/common/oauth2/nativeclient?code=...).\n'
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await rl.question('Cole o endereço aqui e aperte Enter: ')).trim();
  rl.close();

  let code;
  try {
    code = new URL(pasted).searchParams.get('code');
  } catch {
    code = null;
  }
  if (!code) {
    const error = pasted.includes('error=') ? new URL(pasted).searchParams.get('error_description') : null;
    throw new Error(error ? `A Microsoft recusou: ${error}` : 'Não achei o "code=" nesse endereço.');
  }

  const tokenRes = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    throw new Error(`Troca do código falhou: ${tokens.error_description ?? tokenRes.status}`);
  }

  // Confere que o token abre o Xbox Live e descobre a gamertag do robô.
  const userRes = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${tokens.access_token}`,
      },
    }),
  });
  if (!userRes.ok) throw new Error(`Xbox Live recusou o login (user token ${userRes.status}).`);
  const userToken = (await userRes.json()).Token;
  const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify({
      RelyingParty: 'http://xboxlive.com',
      TokenType: 'JWT',
      Properties: { UserTokens: [userToken], SandboxId: 'RETAIL' },
    }),
  });
  const xsts = await xstsRes.json().catch(() => ({}));
  if (!xstsRes.ok) {
    // 2148916233 = conta sem perfil Xbox (falta entrar uma vez em xbox.com).
    const hint =
      xsts.XErr === 2148916233
        ? ' A conta ainda não tem perfil Xbox: entre uma vez em https://www.xbox.com com ela.'
        : xsts.XErr === 2148916238
          ? ' A conta é de menor de idade: use uma conta de adulto.'
          : '';
    throw new Error(`Xbox Live recusou (XSTS ${xstsRes.status}${xsts.XErr ? `, XErr ${xsts.XErr}` : ''}).${hint}`);
  }
  const gamertag = xsts.DisplayClaims?.xui?.[0]?.gtg ?? '(sem gamertag)';

  let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  env = setEnvVar(env, 'XBOX_CLIENT_ID', CLIENT_ID);
  env = setEnvVar(env, 'XBOX_REFRESH_TOKEN', tokens.refresh_token);
  writeFileSync(ENV_FILE, env);

  console.log(`\n✓ Login ok. Conta robô: ${gamertag}`);
  console.log('✓ XBOX_CLIENT_ID e XBOX_REFRESH_TOKEN gravados no .env (o token não foi exibido).');
  console.log('\n3) Agora envie para o Supabase (PowerShell):\n');
  console.log(
    "$t = (Get-Content .env | Where-Object { $_ -match '^XBOX_REFRESH_TOKEN=' }) -replace '^XBOX_REFRESH_TOKEN=', ''"
  );
  console.log(`npx supabase secrets set XBOX_CLIENT_ID=${CLIENT_ID} "XBOX_REFRESH_TOKEN=$t"`);
  console.log('npx supabase functions deploy xbox\n');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
