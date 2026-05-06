import { db, getPersistenceStatus } from '../db/mock-db.js';
import { getNotificationQueueStats } from './notifications.js';
import { getSchedulerStatus } from './scheduler.js';

interface RequestMetric {
  count: number;
  errors: number;
  totalDurationMs: number;
}

const requestMetrics = new Map<string, RequestMetric>();

function metricKey(method: string, route: string, statusCode: number) {
  return `${method.toUpperCase()} ${route} ${statusCode}`;
}

export function recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
  const key = metricKey(method, route, statusCode);
  const current = requestMetrics.get(key) ?? {
    count: 0,
    errors: 0,
    totalDurationMs: 0
  };

  current.count += 1;
  current.totalDurationMs += durationMs;
  if (statusCode >= 400) {
    current.errors += 1;
  }

  requestMetrics.set(key, current);
}

export function getMetricsSnapshot() {
  const notificationQueue = getNotificationQueueStats();
  const scheduler = getSchedulerStatus();
  const persistence = getPersistenceStatus();

  return {
    recordedAt: new Date().toISOString(),
    persistence,
    scheduler,
    queue: {
      notifications: notificationQueue,
      pendingDeviceCommands: db.deviceCommands.filter((item) => item.status !== 'ACKNOWLEDGED').length
    },
    tenants: {
      total: db.tenants.length,
      active: db.tenants.filter((item) => item.status === 'ACTIVE').length,
      suspended: db.tenants.filter((item) => item.status === 'SUSPENDED').length
    },
    entities: {
      users: db.users.length,
      customers: db.customers.length,
      devices: db.devices.length,
      enrolledDevices: db.devices.filter((item) => item.enrollmentStatus === 'ENROLLED').length,
      contracts: db.contracts.length,
      activeContracts: db.contracts.filter((item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED').length,
      payments: db.payments.length,
      notifications: db.notifications.length,
      auditLogs: db.auditLogs.length
    },
    http: Array.from(requestMetrics.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({
        key,
        count: value.count,
        errors: value.errors,
        averageDurationMs: value.count > 0 ? Number((value.totalDurationMs / value.count).toFixed(2)) : 0
      }))
  };
}

export function renderPrometheusMetrics() {
  const snapshot = getMetricsSnapshot();
  const lines: string[] = [];

  lines.push('# HELP financeguard_tenants_total Total number of workspaces');
  lines.push('# TYPE financeguard_tenants_total gauge');
  lines.push(`financeguard_tenants_total ${snapshot.tenants.total}`);
  lines.push(`financeguard_tenants_active ${snapshot.tenants.active}`);
  lines.push(`financeguard_tenants_suspended ${snapshot.tenants.suspended}`);

  lines.push('# HELP financeguard_devices_total Total number of devices');
  lines.push('# TYPE financeguard_devices_total gauge');
  lines.push(`financeguard_devices_total ${snapshot.entities.devices}`);
  lines.push(`financeguard_devices_enrolled ${snapshot.entities.enrolledDevices}`);

  lines.push('# HELP financeguard_notifications_queued Number of queued notifications');
  lines.push('# TYPE financeguard_notifications_queued gauge');
  lines.push(`financeguard_notifications_queued ${snapshot.queue.notifications.queued}`);
  lines.push(`financeguard_notifications_failed ${snapshot.queue.notifications.failed}`);
  lines.push(`financeguard_device_commands_pending ${snapshot.queue.pendingDeviceCommands}`);

  lines.push('# HELP financeguard_http_requests_total Total HTTP requests by method_route_status');
  lines.push('# TYPE financeguard_http_requests_total counter');
  for (const metric of snapshot.http) {
    const [method, ...rest] = metric.key.split(' ');
    const status = rest.pop() ?? '0';
    const route = rest.join(' ');
    const sanitizedRoute = route.replace(/"/g, '\\"');
    lines.push(`financeguard_http_requests_total{method="${method}",route="${sanitizedRoute}",status="${status}"} ${metric.count}`);
    lines.push(`financeguard_http_request_errors_total{method="${method}",route="${sanitizedRoute}",status="${status}"} ${metric.errors}`);
    lines.push(`financeguard_http_request_duration_avg_ms{method="${method}",route="${sanitizedRoute}",status="${status}"} ${metric.averageDurationMs}`);
  }

  return `${lines.join('\n')}\n`;
}
