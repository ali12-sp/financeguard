export type DeviceState = 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
export type EnrollmentStatus = 'PENDING' | 'ENROLLED' | 'SUSPENDED';
export type ContractStatus = 'ACTIVE' | 'LATE' | 'RESTRICTED' | 'COMPLETED' | 'CANCELLED';
export type InstallmentStatus = 'UPCOMING' | 'DUE' | 'GRACE' | 'OVERDUE' | 'PAID';
export type PaymentMatchMode = 'AUTO' | 'MANUAL_OVERRIDE';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'EASYPAISA' | 'JAZZCASH' | 'CARD' | 'OTHER';

export type AuditAction =
  | 'CUSTOMER_CREATED'
  | 'GUARANTOR_CREATED'
  | 'CONTRACT_CREATED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_MATCHED'
  | 'DEVICE_RESTRICTED'
  | 'DEVICE_UNLOCKED'
  | 'DEVICE_RELEASED'
  | 'MANUAL_OVERRIDE'
  | 'RECORD_DELETED'
  | 'DEVICE_CONTROL_RELEASE_REQUESTED'
  | 'PASSWORD_RESET'
  | 'PORTAL_PAYMENT_NOTICE'
  | 'UNLOCK_REVIEW_REQUESTED'
  | 'POLICY_RECOMPUTED';

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  cnic: string;
  address?: string;
}

export interface Guarantor {
  id: string;
  customerId: string;
  contractId?: string;
  fullName: string;
  phone?: string;
  cnic: string;
  relationToCustomer: string;
  address?: string;
}

export interface Device {
  id: string;
  imei: string;
  serial: string;
  modelName: string;
  enrollmentStatus: EnrollmentStatus;
  state: DeviceState;
  adminUnlocked?: boolean;
  restrictionReason?: string;
  assignedCustomerId?: string;
  lastSyncAt?: string;
  manualUnlockUntil?: string;
  manualUnlockReason?: string;
  pendingDeletion?: boolean;
}

export interface Contract {
  id: string;
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
}

export interface Installment {
  id: string;
  contractId: string;
  sequenceNumber: number;
  label: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
}

export interface Payment {
  id: string;
  contractId: string;
  coveredInstallmentIds: string[];
  receivedAmount: number;
  principalApplied: number;
  lateFeeAmount: number;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  receiptUrl?: string;
  receivedAt: string;
  monthCovered: string;
  matchedBy: PaymentMatchMode;
  remainingBalanceAfter: number;
  recordedByUserId: string;
  note?: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  actorName: string;
  action: AuditAction;
  entityType: 'CUSTOMER' | 'GUARANTOR' | 'CONTRACT' | 'PAYMENT' | 'DEVICE' | 'POLICY' | 'USER';
  entityId: string;
  reason: string;
  details?: string;
  createdAt: string;
}
