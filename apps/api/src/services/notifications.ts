import {
  addNotification,
  db,
  type NotificationChannel,
  type NotificationRecord
} from '../db/mock-db.js';
import { scopeToTenant } from './tenancy.js';
import { env } from '../config/env.js';

interface DeliveryResult {
  status: NotificationRecord['status'];
  providerResponse: string;
}

interface NotificationOptions {
  tenantId: string;
  recipient: string;
  message: string;
  template: string;
  customerId?: string;
  deviceId?: string;
  contractId?: string;
  subject?: string;
}

function buildAuthHeaders(apiKey: string) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function uniqueValues(values: Array<string | undefined | null>, lowerCase = false) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = lowerCase ? trimmed.toLowerCase() : trimmed;
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

async function deliverWebhook(
  webhookUrl: string,
  apiKey: string,
  payload: Record<string, string | undefined>,
  notConfiguredMessage: string
): Promise<DeliveryResult> {
  if (!webhookUrl) {
    return {
      status: 'SKIPPED',
      providerResponse: notConfiguredMessage
    };
  }

  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const authHeaders = buildAuthHeaders(apiKey);
    if (authHeaders.Authorization) {
      headers.set('Authorization', authHeaders.Authorization);
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const providerResponse = await response.text();
    return {
      status: response.ok ? 'SENT' : 'FAILED',
      providerResponse
    };
  } catch (error) {
    return {
      status: 'FAILED',
      providerResponse: error instanceof Error ? error.message : 'Unknown webhook delivery error'
    };
  }
}

function createNotificationRecord(
  channel: NotificationChannel,
  result: DeliveryResult,
  options: NotificationOptions
) {
  return addNotification({
    tenantId: options.tenantId,
    channel,
    status: result.status,
    recipient: options.recipient,
    customerId: options.customerId,
    deviceId: options.deviceId,
    contractId: options.contractId,
    message: options.message,
    template: options.template,
    providerResponse: result.providerResponse,
    sentAt: result.status === 'SENT' ? new Date().toISOString() : undefined
  });
}

export function recordSystemNotification(options: {
  tenantId: string;
  recipient: string;
  message: string;
  template: string;
  customerId?: string;
  deviceId?: string;
  contractId?: string;
  providerResponse?: string;
}) {
  return addNotification({
    tenantId: options.tenantId,
    channel: 'SYSTEM',
    status: 'SENT',
    recipient: options.recipient,
    customerId: options.customerId,
    deviceId: options.deviceId,
    contractId: options.contractId,
    message: options.message,
    template: options.template,
    providerResponse: options.providerResponse ?? 'Recorded in the internal activity feed.',
    sentAt: new Date().toISOString()
  });
}

async function deliverSms(phone: string, message: string) {
  return deliverWebhook(
    env.smsWebhookUrl,
    env.smsApiKey,
    {
      to: phone,
      message,
      senderId: env.smsSenderId
    },
    'SMS_WEBHOOK_URL is not configured.'
  );
}

async function deliverEmail(email: string, subject: string, message: string) {
  return deliverWebhook(
    env.emailWebhookUrl,
    env.emailApiKey,
    {
      to: email,
      subject,
      message,
      from: env.emailSender
    },
    'EMAIL_WEBHOOK_URL is not configured.'
  );
}

async function deliverWhatsApp(phone: string, message: string) {
  return deliverWebhook(
    env.whatsappWebhookUrl,
    env.whatsappApiKey,
    {
      to: phone,
      message,
      senderId: env.whatsappSenderId
    },
    'WHATSAPP_WEBHOOK_URL is not configured.'
  );
}

export async function sendSmsNotification(options: NotificationOptions) {
  const result = await deliverSms(options.recipient, options.message);
  return createNotificationRecord('SMS', result, options);
}

export async function sendEmailNotification(options: NotificationOptions) {
  const result = await deliverEmail(
    options.recipient,
    options.subject ?? 'FinanceGuard alert',
    options.message
  );
  return createNotificationRecord('EMAIL', result, options);
}

export async function sendWhatsappNotification(options: NotificationOptions) {
  const result = await deliverWhatsApp(options.recipient, options.message);
  return createNotificationRecord('WHATSAPP', result, options);
}

export async function sendSmsReminder(options: {
  tenantId: string;
  phone: string;
  customerId: string;
  contractId: string;
  message: string;
  template: string;
}) {
  return sendSmsNotification({
    tenantId: options.tenantId,
    recipient: options.phone,
    customerId: options.customerId,
    contractId: options.contractId,
    message: options.message,
    template: options.template
  });
}

function collectWorkspaceAlertRecipients(tenantId: string) {
  const tenant = db.tenants.find((item) => item.id === tenantId) ?? null;
  const workspaceAdmins = scopeToTenant(db.users, tenantId).filter((item) => item.role === 'admin');
  const platformOwners = db.users.filter((item) => item.isPlatformOwner);

  return {
    email: uniqueValues(
      [
        tenant?.contactEmail,
        tenant?.settings.supportEmail,
        ...workspaceAdmins.map((item) => item.email),
        ...platformOwners.map((item) => item.email)
      ],
      true
    ),
    sms: uniqueValues([
      tenant?.settings.supportPhone,
      tenant?.contactPhone,
      ...workspaceAdmins.map((item) => item.phone),
      ...platformOwners.map((item) => item.phone)
    ]),
    whatsapp: uniqueValues([
      tenant?.settings.supportWhatsapp,
      tenant?.settings.supportPhone,
      tenant?.contactPhone,
      ...platformOwners.map((item) => item.phone)
    ])
  };
}

export async function sendDeviceRegistrationNotifications(options: {
  tenantId: string;
  message: string;
  template: string;
  customerId?: string;
  deviceId?: string;
  contractId?: string;
  subject?: string;
  force?: boolean;
}) {
  const tenant = db.tenants.find((item) => item.id === options.tenantId) ?? null;
  if (!tenant) {
    return [];
  }

  if (!options.force && tenant.settings.notifyOnDeviceRegistration === false) {
    return [];
  }

  const recipients = collectWorkspaceAlertRecipients(options.tenantId);
  const subject =
    options.subject ??
    `FinanceGuard device alert for ${tenant.name}`;

  const jobs = [
    ...recipients.email.map((recipient) =>
      sendEmailNotification({
        tenantId: options.tenantId,
        recipient,
        customerId: options.customerId,
        deviceId: options.deviceId,
        contractId: options.contractId,
        message: options.message,
        template: options.template,
        subject
      })
    ),
    ...recipients.sms.map((recipient) =>
      sendSmsNotification({
        tenantId: options.tenantId,
        recipient,
        customerId: options.customerId,
        deviceId: options.deviceId,
        contractId: options.contractId,
        message: options.message,
        template: options.template
      })
    ),
    ...recipients.whatsapp.map((recipient) =>
      sendWhatsappNotification({
        tenantId: options.tenantId,
        recipient,
        customerId: options.customerId,
        deviceId: options.deviceId,
        contractId: options.contractId,
        message: options.message,
        template: options.template
      })
    )
  ];

  return Promise.all(jobs);
}
