import crypto from 'node:crypto';
import { env } from '../config/env.js';

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

export interface FcmSendResult {
  ok: boolean;
  skipped?: boolean;
  providerResponse?: string;
}

let cachedToken: AccessTokenCache | null = null;

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getAccessToken() {
  if (!env.fcmProjectId || !env.fcmClientEmail || !env.fcmPrivateKey) {
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.fcmClientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: expiresAt
  };

  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsignedJwt).end().sign(env.fcmPrivateKey);
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`FCM auth failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000)
  };

  return json.access_token;
}

export async function sendFcmDataMessage(
  registrationToken: string,
  data: Record<string, string>
): Promise<FcmSendResult> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      skipped: true,
      providerResponse: 'FCM environment variables are not configured.'
    };
  }

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.fcmProjectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token: registrationToken,
          data,
          android: {
            priority: 'high'
          }
        }
      })
    }
  );

  const providerResponse = await response.text();
  if (!response.ok) {
    return { ok: false, providerResponse };
  }

  return { ok: true, providerResponse };
}
