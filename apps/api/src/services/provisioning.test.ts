import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAndroidProvisioningPayload,
  normalizeAndroidPackageChecksum
} from './provisioning.js';

test('normalizeAndroidPackageChecksum converts SHA-256 hex to URL-safe base64', () => {
  const hex = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

  assert.equal(
    normalizeAndroidPackageChecksum(hex),
    'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
  );
});

test('buildAndroidProvisioningPayload includes permanent QR metadata when workspace APK settings exist', () => {
  const result = buildAndroidProvisioningPayload({
    adminComponent: 'com.financeguard.agent/.FinanceGuardDeviceAdminReceiver',
    apiBaseUrl: 'https://api.example.com',
    agentSecret: 'FG-test',
    deviceId: 'd-test',
    organizationId: 'workspace',
    organizationName: 'Workspace',
    frpAccountsCsv: 'admin@example.com',
    settings: {
      defaultDueDayOfMonth: 10,
      defaultGraceDays: 3,
      defaultEnrollmentMode: 'QR',
      defaultLockMessage: 'Payment overdue.',
      notifyOnDeviceRegistration: true,
      agentApkDownloadUrl: 'https://cdn.example.com/financeguard-agent.apk',
      agentApkChecksum: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    }
  });

  assert.deepEqual(result.missingRequirements, []);
  assert.equal(result.agentApkChecksum, 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
  assert.match(result.qrPayload ?? '', /PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION/);
  assert.match(result.qrPayload ?? '', /PROVISIONING_ADMIN_EXTRAS_BUNDLE/);
});
