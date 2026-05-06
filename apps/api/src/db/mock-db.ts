import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import {
  hashPassword,
  isHashedPassword
} from '../services/passwords.js';

export type DeviceState = 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
export type EnrollmentStatus = 'PENDING' | 'ENROLLED' | 'SUSPENDED';
export type EnrollmentMode = 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
export type ContractStatus = 'ACTIVE' | 'LATE' | 'RESTRICTED' | 'COMPLETED' | 'CANCELLED';
export type InstallmentStatus = 'UPCOMING' | 'DUE' | 'GRACE' | 'OVERDUE' | 'PAID';
export type PaymentMatchMode = 'AUTO' | 'MANUAL_OVERRIDE';
export type AppRole = 'admin' | 'staff' | 'customer';
export type AuditAction =
  | 'CUSTOMER_CREATED'
  | 'GUARANTOR_CREATED'
  | 'CONTRACT_CREATED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_MATCHED'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_RESTRICTED'
  | 'DEVICE_UNLOCKED'
  | 'DEVICE_RELEASED'
  | 'MANUAL_OVERRIDE'
  | 'POLICY_RECOMPUTED';
export type DeviceCommandType = 'LOCK' | 'UNLOCK' | 'REMINDER' | 'SYNC';
export type DeviceCommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED';
export type ReminderStage = 'FIVE_DAYS' | 'TWO_DAYS' | 'DUE_TODAY' | 'OVERDUE_LOCK';
export type NotificationChannel = 'FCM' | 'SMS' | 'EMAIL' | 'WHATSAPP' | 'SYSTEM';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
export type PersistenceEngine = 'sqlite' | 'postgres';

export type JsonPayload = Record<string, string | number | boolean | null>;
export interface WorkspaceSettings {
  defaultDueDayOfMonth: number;
  defaultGraceDays: number;
  defaultEnrollmentMode: EnrollmentMode;
  defaultLockMessage: string;
  notifyOnDeviceRegistration: boolean;
  supportEmail?: string;
  supportPhone?: string;
  supportWhatsapp?: string;
  agentApkDownloadUrl?: string;
  agentApkChecksum?: string;
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  contactEmail?: string;
  contactPhone?: string;
  settings: WorkspaceSettings;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: AppRole;
  isPlatformOwner?: boolean;
  customerId?: string;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  cnic: string;
  address?: string;
  notes?: string;
}

export interface GuarantorRecord {
  id: string;
  tenantId: string;
  customerId: string;
  contractId?: string;
  fullName: string;
  phone?: string;
  cnic: string;
  relationToCustomer: string;
  address?: string;
}

export interface DeviceRecord {
  id: string;
  tenantId: string;
  imei: string;
  serial: string;
  modelName: string;
  agentSecret: string;
  enrollmentStatus: EnrollmentStatus;
  enrollmentMode?: EnrollmentMode;
  state: DeviceState;
  adminLocked?: boolean;
  restrictionReason?: string;
  assignedCustomerId?: string;
  uniqueId?: string;
  pushToken?: string;
  osVersion?: string;
  appVersion?: string;
  deviceOwnerPackage?: string;
  lastCommandId?: string;
  lastSyncAt?: string;
}

export interface ContractRecord {
  id: string;
  tenantId: string;
  customerId: string;
  deviceId: string;
  guarantorIds: string[];
  totalPhonePrice: number;
  advancePayment: number;
  financedAmount: number;
  monthlyInstallment: number;
  totalMonths: number;
  dueDayOfMonth: number;
  graceDays: number;
  agreementAccepted: boolean;
  agreementAcceptedAt?: string;
  deviceImei: string;
  deviceSerial: string;
  startDate: string;
  status: ContractStatus;
  paymentNotes?: string;
}

export interface InstallmentRecord {
  id: string;
  tenantId: string;
  contractId: string;
  sequenceNumber: number;
  label: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
}

export interface PaymentRecord {
  id: string;
  tenantId: string;
  contractId: string;
  coveredInstallmentIds: string[];
  receivedAmount: number;
  principalApplied: number;
  lateFeeAmount: number;
  receivedAt: string;
  monthCovered: string;
  matchedBy: PaymentMatchMode;
  remainingBalanceAfter: number;
  recordedByUserId: string;
  note?: string;
}

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  actorUserId: string;
  actorName: string;
  action: AuditAction;
  entityType: 'CUSTOMER' | 'GUARANTOR' | 'CONTRACT' | 'PAYMENT' | 'DEVICE' | 'POLICY';
  entityId: string;
  reason: string;
  details?: string;
  createdAt: string;
}

export interface DeviceCommandRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  contractId?: string;
  type: DeviceCommandType;
  status: DeviceCommandStatus;
  reason: string;
  lockMessage?: string;
  payload?: JsonPayload;
  source: 'ADMIN' | 'SYSTEM' | 'PAYMENT' | 'SCHEDULER' | 'DEVICE';
  createdAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  responseNote?: string;
}

export interface ReminderEventRecord {
  id: string;
  tenantId: string;
  contractId: string;
  installmentId: string;
  customerId: string;
  deviceId: string;
  stage: ReminderStage;
  channels: NotificationChannel[];
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  recipient: string;
  customerId?: string;
  deviceId?: string;
  contractId?: string;
  message: string;
  template: string;
  providerResponse?: string;
  createdAt: string;
  sentAt?: string;
}

export interface DatabaseRecord {
  tenants: TenantRecord[];
  users: UserRecord[];
  customers: CustomerRecord[];
  guarantors: GuarantorRecord[];
  devices: DeviceRecord[];
  contracts: ContractRecord[];
  installments: InstallmentRecord[];
  payments: PaymentRecord[];
  auditLogs: AuditLogRecord[];
  deviceCommands: DeviceCommandRecord[];
  reminderEvents: ReminderEventRecord[];
  notifications: NotificationRecord[];
}

export interface PersistenceStatus {
  engine: PersistenceEngine;
  sqlitePath?: string;
  databaseUrl?: string;
  lastPersistedAt: string | null;
  lastBackupAt: string | null;
  lastPersistError: string | null;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatDateOnly(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export function buildDefaultWorkspaceSettings(
  overrides: Partial<WorkspaceSettings> = {}
): WorkspaceSettings {
  return {
    defaultDueDayOfMonth: overrides.defaultDueDayOfMonth ?? 10,
    defaultGraceDays: overrides.defaultGraceDays ?? 3,
    defaultEnrollmentMode: overrides.defaultEnrollmentMode ?? 'QR',
    defaultLockMessage:
      overrides.defaultLockMessage ??
      'Payment overdue. Contact the installment office to unlock this phone.',
    notifyOnDeviceRegistration: overrides.notifyOnDeviceRegistration ?? true,
    supportEmail: overrides.supportEmail?.trim().toLowerCase() || undefined,
    supportPhone: overrides.supportPhone?.trim() || undefined,
    supportWhatsapp: overrides.supportWhatsapp?.trim() || undefined,
    agentApkDownloadUrl: overrides.agentApkDownloadUrl?.trim() || undefined,
    agentApkChecksum: overrides.agentApkChecksum?.trim() || undefined
  };
}

function buildDueDate(startDate: string, monthOffset: number, dueDayOfMonth: number) {
  const [year, month] = startDate.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const lastDayOfMonth = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const safeDueDay = Math.min(dueDayOfMonth, lastDayOfMonth);

  return formatDateOnly(
    new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), safeDueDay))
  );
}

export function buildInstallmentSchedule(contract: ContractRecord, idPrefix = `ins-${contract.id}`) {
  return Array.from({ length: contract.totalMonths }, (_, index) => {
    const dueDate = buildDueDate(contract.startDate, index, contract.dueDayOfMonth);
    const dueDateValue = new Date(`${dueDate}T00:00:00Z`);
    const remainingBeforeCurrent = contract.financedAmount - (contract.monthlyInstallment * index);
    const amountDue =
      index === contract.totalMonths - 1
        ? Math.max(remainingBeforeCurrent, 0)
        : Math.min(contract.monthlyInstallment, Math.max(remainingBeforeCurrent, 0));

    return {
      id: `${idPrefix}-${index + 1}`,
      tenantId: contract.tenantId,
      contractId: contract.id,
      sequenceNumber: index + 1,
      label: formatMonthLabel(dueDateValue),
      dueDate,
      amountDue,
      amountPaid: 0
    } satisfies InstallmentRecord;
  });
}

function markInstallmentPaid(
  installments: InstallmentRecord[],
  installmentId: string,
  amountPaid: number
) {
  const installment = installments.find((item) => item.id === installmentId);
  if (installment) {
    installment.amountPaid = amountPaid;
  }
}

function createSeedDatabase(): DatabaseRecord {
  return {
    tenants: [],
    users: [],
    customers: [],
    guarantors: [],
    devices: [],
    contracts: [],
    installments: [],
    payments: [],
    auditLogs: [],
    deviceCommands: [],
    reminderEvents: [],
    notifications: []
  };
}

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const legacyJsonFile = path.join(dataDir, 'store.json');
const sqliteFile = path.join(dataDir, 'financeguard.sqlite');
const backupDir = path.join(dataDir, 'backups');
const COLLECTION_NAMES = [
  'tenants',
  'users',
  'customers',
  'guarantors',
  'devices',
  'contracts',
  'installments',
  'payments',
  'auditLogs',
  'deviceCommands',
  'reminderEvents',
  'notifications'
] as const satisfies Array<keyof DatabaseRecord>;
type CollectionName = (typeof COLLECTION_NAMES)[number];

let lastPersistedAt: string | null = null;
let lastBackupAt: string | null = null;
let lastPersistError: string | null = null;

function normalizeDatabase(raw: Partial<DatabaseRecord>): DatabaseRecord {
  const seed = createSeedDatabase();
  return {
    tenants: raw.tenants ?? seed.tenants,
    users: raw.users ?? seed.users,
    customers: raw.customers ?? seed.customers,
    guarantors: raw.guarantors ?? seed.guarantors,
    devices: raw.devices ?? seed.devices,
    contracts: raw.contracts ?? seed.contracts,
    installments: raw.installments ?? seed.installments,
    payments: raw.payments ?? seed.payments,
    auditLogs: raw.auditLogs ?? seed.auditLogs,
    deviceCommands: raw.deviceCommands ?? seed.deviceCommands,
    reminderEvents: raw.reminderEvents ?? seed.reminderEvents,
    notifications: raw.notifications ?? seed.notifications
  };
}

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
}

function createSqliteConnection() {
  ensureDataDir();
  const database = new DatabaseSync(sqliteFile);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      sort_index INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
  return database;
}

function redactDatabaseUrl(value: string) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return 'postgres://configured';
  }
}

const sqlite = createSqliteConnection();
const postgres =
  env.persistenceEngine === 'postgres'
    ? new Pool({
        connectionString: env.databaseUrl || undefined,
        ssl:
          env.databaseSslMode === 'require'
            ? { rejectUnauthorized: false }
            : undefined
      })
    : null;

interface PersistenceAdapter {
  engine: PersistenceEngine;
  describe(): Pick<PersistenceStatus, 'sqlitePath' | 'databaseUrl'>;
  load(): Promise<DatabaseRecord | null>;
  persist(snapshot: DatabaseRecord, persistedAt: string): Promise<void>;
}

function readLegacyJsonDatabase() {
  if (!fs.existsSync(legacyJsonFile)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8')) as Partial<DatabaseRecord>;
    return normalizeDatabase(raw);
  } catch {
    return null;
  }
}

function loadCollectionsFromSqlite() {
  const rows = sqlite.prepare(`
    SELECT collection, payload
    FROM app_records
    ORDER BY collection ASC, sort_index ASC
  `).all() as Array<{ collection: CollectionName; payload: string }>;

  const partial: Partial<DatabaseRecord> = {};
  for (const collection of COLLECTION_NAMES) {
    partial[collection] = rows
      .filter((row) => row.collection === collection)
      .map((row) => JSON.parse(row.payload));
  }

  return normalizeDatabase(partial);
}

function loadPersistedAtFromSqlite() {
  const row = sqlite.prepare(`
    SELECT value
    FROM app_meta
    WHERE key = 'last_persisted_at'
  `).get() as { value?: string } | undefined;

  return row?.value ?? null;
}

function persistSnapshotToSqlite(
  snapshot: DatabaseRecord,
  persistedAt = new Date().toISOString()
) {
  sqlite.exec('BEGIN IMMEDIATE');

  try {
    for (const collection of COLLECTION_NAMES) {
      sqlite.prepare('DELETE FROM app_records WHERE collection = ?').run(collection);

      const rows = snapshot[collection] as Array<{ id: string }>;
      rows.forEach((row, index) => {
        sqlite.prepare(`
          INSERT INTO app_records (collection, id, payload, sort_index, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          collection,
          row.id,
          JSON.stringify(row),
          index,
          persistedAt
        );
      });
    }

    sqlite.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('last_persisted_at', persistedAt);
    sqlite.exec('COMMIT');
    lastPersistedAt = persistedAt;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

async function ensurePostgresSchema() {
  if (!postgres) {
    throw new Error('PostgreSQL adapter is not configured.');
  }

  await postgres.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload JSONB NOT NULL,
      sort_index INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
}

async function loadCollectionsFromPostgres() {
  if (!postgres) {
    throw new Error('PostgreSQL adapter is not configured.');
  }

  await ensurePostgresSchema();
  const countResult = await postgres.query(
    'SELECT COUNT(*)::text AS count FROM app_records'
  ) as { rows: Array<{ count: string }> };
  if (Number(countResult.rows[0]?.count ?? '0') === 0) {
    return null;
  }

  const rows = await postgres.query(`
    SELECT collection, payload
    FROM app_records
    ORDER BY collection ASC, sort_index ASC
  `) as { rows: Array<{ collection: CollectionName; payload: unknown }> };

  const persistedAtRow = await postgres.query(`
    SELECT value
    FROM app_meta
    WHERE key = 'last_persisted_at'
  `) as { rows: Array<{ value: string }> };
  lastPersistedAt = persistedAtRow.rows[0]?.value ?? null;

  const postgresRows = rows.rows as Array<{ collection: CollectionName; payload: unknown }>;
  const partial: Partial<DatabaseRecord> = {};
  const partialCollections = partial as Record<CollectionName, unknown[]>;
  for (const collection of COLLECTION_NAMES) {
    partialCollections[collection] = postgresRows
      .filter((row) => row.collection === collection)
      .map((row) => row.payload);
  }

  return normalizeDatabase(partial);
}

async function persistSnapshotToPostgres(
  snapshot: DatabaseRecord,
  persistedAt = new Date().toISOString()
) {
  if (!postgres) {
    throw new Error('PostgreSQL adapter is not configured.');
  }

  await ensurePostgresSchema();
  const client = await postgres.connect();

  try {
    await client.query('BEGIN');

    for (const collection of COLLECTION_NAMES) {
      await client.query('DELETE FROM app_records WHERE collection = $1', [collection]);

      const rows = snapshot[collection] as Array<{ id: string }>;
      for (const [index, row] of rows.entries()) {
        await client.query(
          `
            INSERT INTO app_records (collection, id, payload, sort_index, updated_at)
            VALUES ($1, $2, $3::jsonb, $4, $5)
          `,
          [collection, row.id, JSON.stringify(row), index, persistedAt]
        );
      }
    }

    await client.query(
      `
        INSERT INTO app_meta (key, value) VALUES ($1, $2)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
      `,
      ['last_persisted_at', persistedAt]
    );

    await client.query('COMMIT');
    lastPersistedAt = persistedAt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const sqliteAdapter: PersistenceAdapter = {
  engine: 'sqlite',
  describe() {
    return { sqlitePath: sqliteFile };
  },
  async load() {
    const row = sqlite.prepare('SELECT COUNT(*) AS count FROM app_records').get() as {
      count: number;
    };

    if (row.count === 0) {
      return null;
    }

    lastPersistedAt = loadPersistedAtFromSqlite();
    return loadCollectionsFromSqlite();
  },
  async persist(snapshot, persistedAt) {
    persistSnapshotToSqlite(snapshot, persistedAt);
  }
};

const postgresAdapter: PersistenceAdapter = {
  engine: 'postgres',
  describe() {
    return { databaseUrl: redactDatabaseUrl(env.databaseUrl) };
  },
  async load() {
    return loadCollectionsFromPostgres();
  },
  async persist(snapshot, persistedAt) {
    await persistSnapshotToPostgres(snapshot, persistedAt);
  }
};

const persistenceAdapter =
  env.persistenceEngine === 'postgres' ? postgresAdapter : sqliteAdapter;

function maybeCreateBackupSnapshot(snapshot: DatabaseRecord, force = false) {
  if (!force && env.backupIntervalMs <= 0) {
    return;
  }

  const now = Date.now();
  const previousBackup = lastBackupAt ? Date.parse(lastBackupAt) : 0;
  if (!force && previousBackup && now - previousBackup < env.backupIntervalMs) {
    return;
  }

  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `financeguard-${timestamp}.json`);
  fs.writeFileSync(backupFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  lastBackupAt = new Date(now).toISOString();
}

async function loadDatabase() {
  const existing = await persistenceAdapter.load();
  if (!existing) {
    const imported =
      (env.persistenceEngine === 'postgres' ? await sqliteAdapter.load() : null) ??
      readLegacyJsonDatabase() ??
      createSeedDatabase();
    await persistenceAdapter.persist(imported, new Date().toISOString());
    maybeCreateBackupSnapshot(imported);
    return imported;
  }

  return existing;
}

export const db: DatabaseRecord = await loadDatabase();

let persistQueue = Promise.resolve();

export function persistDb() {
  const snapshot = structuredClone(db);
  const persistedAt = new Date().toISOString();
  const task = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await persistenceAdapter.persist(snapshot, persistedAt);
      maybeCreateBackupSnapshot(snapshot);
      lastPersistError = null;
    });

  persistQueue = task.catch((error) => {
    lastPersistError = error instanceof Error ? error.message : 'Unknown persistence error';
    console.error('Persistence failed', error);
  });

  return task;
}

function getMaxNumericSuffix(prefix: string, items: Array<{ id: string }>) {
  return items.reduce((max, item) => {
    const match = item.id.match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

export function nextNumericId(prefix: string, items: Array<{ id: string }>) {
  return `${prefix}${getMaxNumericSuffix(prefix, items) + 1}`;
}

function databaseHasBusinessData() {
  return [
    db.users.length,
    db.customers.length,
    db.guarantors.length,
    db.devices.length,
    db.contracts.length,
    db.installments.length,
    db.payments.length,
    db.auditLogs.length,
    db.deviceCommands.length,
    db.reminderEvents.length,
    db.notifications.length
  ].some((count) => count > 0);
}

function assignTenantIdIfMissing<T extends { tenantId?: string }>(rows: T[], tenantId: string) {
  let changed = false;

  for (const row of rows) {
    if (!row.tenantId) {
      row.tenantId = tenantId;
      changed = true;
    }
  }

  return changed;
}

async function ensureTenantMigration() {
  let changed = false;

  if (db.tenants.length === 0 && databaseHasBusinessData()) {
    const primaryAdmin = db.users.find((item) => item.role === 'admin') ?? db.users[0];
    db.tenants.push({
      id: nextNumericId('t', db.tenants),
      name: 'Primary Workspace',
      slug: 'primary-workspace',
      status: 'ACTIVE',
      contactEmail: primaryAdmin?.email,
      contactPhone: primaryAdmin?.phone,
      settings: buildDefaultWorkspaceSettings({
        supportEmail: primaryAdmin?.email,
        supportPhone: primaryAdmin?.phone
      }),
      createdAt: new Date().toISOString()
    });
    changed = true;
  }

  const fallbackTenantId = db.tenants[0]?.id;
  if (!fallbackTenantId) {
    if (changed) {
      await persistDb();
    }
    return;
  }

  changed = assignTenantIdIfMissing(db.users, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.customers, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.guarantors, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.devices, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.contracts, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.installments, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.payments, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.auditLogs, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.deviceCommands, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.reminderEvents, fallbackTenantId) || changed;
  changed = assignTenantIdIfMissing(db.notifications, fallbackTenantId) || changed;

  if (changed) {
    await persistDb();
  }
}

async function ensurePasswordsAreHashed() {
  let changed = false;

  for (const user of db.users) {
    if (!isHashedPassword(user.password)) {
      user.password = hashPassword(user.password);
      changed = true;
    }
  }

  if (changed) {
    await persistDb();
  }
}

async function ensureWorkspaceSettingsMigration() {
  let changed = false;

  for (const tenant of db.tenants) {
    if (!tenant.settings) {
      tenant.settings = buildDefaultWorkspaceSettings({
        supportEmail: tenant.contactEmail,
        supportPhone: tenant.contactPhone
      });
      changed = true;
      continue;
    }

    const normalized = buildDefaultWorkspaceSettings({
      defaultDueDayOfMonth: tenant.settings.defaultDueDayOfMonth,
      defaultGraceDays: tenant.settings.defaultGraceDays,
      defaultEnrollmentMode: tenant.settings.defaultEnrollmentMode,
      defaultLockMessage: tenant.settings.defaultLockMessage,
      notifyOnDeviceRegistration: tenant.settings.notifyOnDeviceRegistration,
      supportEmail: tenant.settings.supportEmail ?? tenant.contactEmail,
      supportPhone: tenant.settings.supportPhone ?? tenant.contactPhone,
      supportWhatsapp: tenant.settings.supportWhatsapp,
      agentApkDownloadUrl: tenant.settings.agentApkDownloadUrl,
      agentApkChecksum: tenant.settings.agentApkChecksum
    });

    if (JSON.stringify(normalized) !== JSON.stringify(tenant.settings)) {
      tenant.settings = normalized;
      changed = true;
    }
  }

  if (changed) {
    await persistDb();
  }
}

async function ensurePlatformOwnerMigration() {
  if (db.users.some((item) => item.isPlatformOwner)) {
    return;
  }

  const primaryAdmin = db.users.find((item) => item.role === 'admin') ?? null;
  if (!primaryAdmin) {
    return;
  }

  primaryAdmin.isPlatformOwner = true;
  await persistDb();
}

export async function createBackupSnapshot() {
  maybeCreateBackupSnapshot(db, true);
  return lastBackupAt;
}

export function getPersistenceStatus(): PersistenceStatus {
  return {
    engine: persistenceAdapter.engine,
    ...persistenceAdapter.describe(),
    lastPersistedAt,
    lastBackupAt,
    lastPersistError
  };
}

await ensurePasswordsAreHashed();
await ensureTenantMigration();
await ensureWorkspaceSettingsMigration();
await ensurePlatformOwnerMigration();

export function addAuditLog(
  log: Omit<AuditLogRecord, 'id' | 'createdAt'> & { createdAt?: string }
) {
  const record: AuditLogRecord = {
    id: nextNumericId('a', db.auditLogs),
    createdAt: log.createdAt ?? new Date().toISOString(),
    ...log
  };

  db.auditLogs.unshift(record);
  void persistDb();
  return record;
}

export function addReminderEvent(
  reminder: Omit<ReminderEventRecord, 'id' | 'createdAt'> & { createdAt?: string }
) {
  const record: ReminderEventRecord = {
    id: nextNumericId('r', db.reminderEvents),
    createdAt: reminder.createdAt ?? new Date().toISOString(),
    ...reminder
  };

  db.reminderEvents.unshift(record);
  void persistDb();
  return record;
}

export function addNotification(
  notification: Omit<NotificationRecord, 'id' | 'createdAt'> & { createdAt?: string }
) {
  const record: NotificationRecord = {
    id: nextNumericId('n', db.notifications),
    createdAt: notification.createdAt ?? new Date().toISOString(),
    ...notification
  };

  db.notifications.unshift(record);
  void persistDb();
  return record;
}

export function addDeviceCommand(
  command: Omit<DeviceCommandRecord, 'id' | 'createdAt' | 'status'> & {
    createdAt?: string;
    status?: DeviceCommandStatus;
  }
) {
  const record: DeviceCommandRecord = {
    id: nextNumericId('cmd', db.deviceCommands),
    createdAt: command.createdAt ?? new Date().toISOString(),
    status: command.status ?? 'PENDING',
    ...command
  };

  db.deviceCommands.unshift(record);
  void persistDb();
  return record;
}
