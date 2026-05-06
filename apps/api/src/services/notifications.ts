import {
  addNotification,
  db,
  persistDb,
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

function queueNotification(
  channel: NotificationChannel,
  options: NotificationOptions,
  providerResponse = 'Queued for background delivery.'
) {
  return addNotification({
    tenantId: options.tenantId,
    channel,
    status: 'QUEUED',
    recipient: options.recipient,
    customerId: options.customerId,
    deviceId: options.deviceId,
    contractId: options.contractId,
    message: options.message,
    template: options.template,
    providerResponse
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

export function queueSmsNotification(options: NotificationOptions) {
  return queueNotification('SMS', options);
}

export function queueEmailNotification(options: NotificationOptions) {
  return queueNotification('EMAIL', options);
}

export function queueWhatsappNotification(options: NotificationOptions) {
  return queueNotification('WHATSAPP', options);
}

export function sendSmsReminder(options: {
  tenantId: string;
  phone: string;
  customerId: string;
  contractId: string;
  message: string;
  template: string;
}) {
  return queueSmsNotification({
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

  const queued = [
    ...recipients.email.map((recipient) =>
      queueEmailNotification({
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
      queueSmsNotification({
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
      queueWhatsappNotification({
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

  await persistDb();
  return queued;
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

async function dispatchNotification(notification: NotificationRecord) {
  if (notification.channel === 'SYSTEM' || notification.channel === 'FCM') {
    notification.status = 'SKIPPED';
    notification.providerResponse = `${notification.channel} notifications are not dispatched by the background notification worker.`;
    return notification;
  }

  const result =
    notification.channel === 'SMS'
      ? await deliverSms(notification.recipient, notification.message)
      : notification.channel === 'EMAIL'
        ? await deliverEmail(notification.recipient, 'FinanceGuard alert', notification.message)
        : await deliverWhatsApp(notification.recipient, notification.message);

  notification.status = result.status;
  notification.providerResponse = result.providerResponse;
  notification.sentAt = result.status === 'SENT' ? new Date().toISOString() : undefined;
  return notification;
}

export async function processQueuedNotifications(limit = 25) {
  const queued = db.notifications
    .filter((item) => item.status === 'QUEUED')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit);

  if (queued.length === 0) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0
    };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of queued) {
    const result = await dispatchNotification(notification);
    if (result.status === 'SENT') {
      sent += 1;
    } else if (result.status === 'FAILED') {
      failed += 1;
    } else if (result.status === 'SKIPPED') {
      skipped += 1;
    }
  }

  await persistDb();

  return {
    processed: queued.length,
    sent,
    failed,
    skipped
  };
}

export function getNotificationQueueStats() {
  return {
    queued: db.notifications.filter((item) => item.status === 'QUEUED').length,
    sent: db.notifications.filter((item) => item.status === 'SENT').length,
    failed: db.notifications.filter((item) => item.status === 'FAILED').length,
    skipped: db.notifications.filter((item) => item.status === 'SKIPPED').length
  };
}
