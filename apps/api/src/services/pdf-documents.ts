import { db, type ContractRecord, type PaymentRecord } from '../db/mock-db.js';
import { getContractDetail, getPaymentSummary } from '../modules/contracts/ledger.js';

interface PdfSection {
  heading?: string;
  rows: Array<[string, string | number | null | undefined]>;
}

function formatMoney(value: number | null | undefined) {
  return `PKR ${Math.round(value ?? 0).toLocaleString('en-US')}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

function addText(lines: string[], x: number, y: number, size: number, text: string) {
  lines.push('BT');
  lines.push(`/F1 ${size} Tf`);
  lines.push(`1 0 0 1 ${x} ${y} Tm`);
  lines.push(`(${escapePdfText(text)}) Tj`);
  lines.push('ET');
}

function buildPdf(title: string, sections: PdfSection[]) {
  const content: string[] = [];
  let y = 790;

  addText(content, 54, y, 20, title);
  y -= 18;
  addText(content, 54, y, 9, `Generated ${formatDateTime(new Date().toISOString())}`);
  y -= 26;

  for (const section of sections) {
    if (section.heading) {
      addText(content, 54, y, 13, section.heading);
      y -= 18;
    }

    for (const [label, rawValue] of section.rows) {
      if (y < 72) break;
      const value = rawValue === null || rawValue === undefined || rawValue === '' ? '-' : String(rawValue);
      addText(content, 72, y, 10, `${label}:`);
      addText(content, 230, y, 10, value.slice(0, 70));
      y -= 16;
    }

    y -= 10;
  }

  addText(content, 54, 44, 9, 'FinanceGuard receipt and invoice documents are generated from the tenant ledger.');

  const stream = content.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

function getTenantName(tenantId: string) {
  return db.tenants.find((tenant) => tenant.id === tenantId)?.name ?? tenantId;
}

function getContractCustomer(contract: ContractRecord) {
  return db.customers.find(
    (customer) => customer.tenantId === contract.tenantId && customer.id === contract.customerId
  ) ?? null;
}

function getContractDevice(contract: ContractRecord) {
  return db.devices.find(
    (device) => device.tenantId === contract.tenantId && device.id === contract.deviceId
  ) ?? null;
}

export function createPaymentReceiptPdf(payment: PaymentRecord) {
  const summary = getPaymentSummary(payment);
  const contract = db.contracts.find(
    (item) => item.tenantId === payment.tenantId && item.id === payment.contractId
  ) ?? null;
  const customer = contract ? getContractCustomer(contract) : null;
  const device = contract ? getContractDevice(contract) : null;

  return buildPdf('FinanceGuard Payment Receipt', [
    {
      heading: 'Receipt',
      rows: [
        ['Receipt No', payment.id],
        ['Workspace', getTenantName(payment.tenantId)],
        ['Received At', formatDateTime(payment.receivedAt)],
        ['Recorded By', summary.recordedByName]
      ]
    },
    {
      heading: 'Customer And Device',
      rows: [
        ['Customer', customer?.fullName ?? summary.customerName],
        ['Phone', customer?.phone],
        ['Contract', payment.contractId],
        ['Device', device ? `${device.modelName} / ${device.serial}` : summary.deviceModel]
      ]
    },
    {
      heading: 'Payment',
      rows: [
        ['Month Covered', payment.monthCovered],
        ['Payment Method', payment.paymentMethod ?? 'CASH'],
        ['Reference', payment.referenceNumber],
        ['Principal Applied', formatMoney(payment.principalApplied)],
        ['Late Fee', formatMoney(payment.lateFeeAmount)],
        ['Total Received', formatMoney(payment.receivedAmount)],
        ['Remaining Balance', formatMoney(payment.remainingBalanceAfter)],
        ['Note', payment.note]
      ]
    }
  ]);
}

export function createContractInvoicePdf(contract: ContractRecord) {
  const detail = getContractDetail(contract);
  const customer = getContractCustomer(contract);
  const device = getContractDevice(contract);
  const installmentRows = detail.installments.slice(0, 12).map((installment) => [
    `#${installment.sequenceNumber} ${installment.label}`,
    `${installment.dueDate} | ${formatMoney(installment.amountDue)} due | ${formatMoney(installment.amountPaid)} paid | ${installment.status}`
  ] as [string, string]);

  return buildPdf('FinanceGuard Financing Invoice', [
    {
      heading: 'Invoice',
      rows: [
        ['Invoice No', `INV-${contract.id}`],
        ['Workspace', getTenantName(contract.tenantId)],
        ['Contract', contract.id],
        ['Status', detail.status],
        ['Policy State', detail.policyState]
      ]
    },
    {
      heading: 'Customer And Device',
      rows: [
        ['Customer', customer?.fullName ?? detail.customerName],
        ['Phone', customer?.phone ?? detail.customerPhone],
        ['Device', device ? `${device.modelName} / ${device.serial}` : detail.deviceModel],
        ['IMEI', contract.deviceImei]
      ]
    },
    {
      heading: 'Financials',
      rows: [
        ['Total Phone Price', formatMoney(contract.totalPhonePrice)],
        ['Advance Payment', formatMoney(contract.advancePayment)],
        ['Financed Amount', formatMoney(contract.financedAmount)],
        ['Monthly Installment', formatMoney(contract.monthlyInstallment)],
        ['Principal Paid', formatMoney(detail.totalPaid)],
        ['Late Fees Paid', formatMoney(detail.lateFeesPaid)],
        ['Remaining Balance', formatMoney(detail.remainingBalance)],
        ['Next Due Date', detail.nextDueDate],
        ['Next Due Label', detail.nextDueLabel]
      ]
    },
    {
      heading: 'Installment Schedule',
      rows: installmentRows.length > 0 ? installmentRows : [['Installments', 'No installments found']]
    }
  ]);
}

