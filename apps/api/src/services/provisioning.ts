import type { WorkspaceSettings } from '../db/mock-db.js';

export interface ProvisioningPayloadOptions {
  adminComponent: string;
  apiBaseUrl: string;
  agentSecret: string;
  deviceId: string;
  organizationId: string;
  organizationName: string;
  frpAccountsCsv: string;
  settings?: WorkspaceSettings | null;
}

export function normalizeAndroidPackageChecksum(value?: string) {
  const checksum = value?.trim();
  if (!checksum) {
    return undefined;
  }

  if (/^[a-f0-9]{64}$/i.test(checksum)) {
    return Buffer.from(checksum, 'hex').toString('base64url');
  }

  return checksum;
}

export function buildAndroidProvisioningPayload(options: ProvisioningPayloadOptions) {
  const agentApkDownloadUrl = options.settings?.agentApkDownloadUrl?.trim();
  const agentApkChecksum = normalizeAndroidPackageChecksum(options.settings?.agentApkChecksum);
  const missingRequirements: string[] = [];

  if (!agentApkDownloadUrl) {
    missingRequirements.push('Agent APK download URL');
  }

  if (!agentApkChecksum) {
    missingRequirements.push('Agent APK checksum');
  }

  const adminExtras = {
    apiBaseUrl: options.apiBaseUrl,
    agentSecret: options.agentSecret,
    deviceId: options.deviceId,
    organizationId: options.organizationId,
    organizationName: options.organizationName,
    frpAccountsCsv: options.frpAccountsCsv
  };

  const payload =
    agentApkDownloadUrl && agentApkChecksum
      ? {
          'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': options.adminComponent,
          'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': agentApkDownloadUrl,
          'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM': agentApkChecksum,
          'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': adminExtras
        }
      : null;

  return {
    adminExtras,
    agentApkDownloadUrl,
    agentApkChecksum,
    missingRequirements,
    qrPayload: payload ? JSON.stringify(payload) : undefined,
    qrPayloadPretty: payload ? JSON.stringify(payload, null, 2) : undefined
  };
}
