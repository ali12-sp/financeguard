# FinanceGuard Device Enrollment Runbook

This is the practical rollout path for a financed-phone business that does **not** use zero-touch enrollment yet.

## Goal

Keep strong device control without depending on zero-touch.

The correct supported path is:

1. factory reset the phone
2. enroll it as **Android Enterprise Device Owner**
3. use **QR provisioning** during setup
4. verify registration before handing the phone to the customer

If the app is only installed normally after setup, you do **not** have full control.

## Standard Shop Floor Flow

1. Create or open the correct workspace for the shopkeeper.
2. Create the customer and device record from the FinanceGuard admin panel.
3. Open `Devices` and load the device `Provisioning` details.
4. Generate the enrollment QR using:
   - device admin component
   - APK HTTPS URL
   - APK SHA-256 checksum
   - admin extras bundle from the provisioning response
5. Factory reset the phone.
6. On the Android welcome screen, start enterprise QR enrollment.
7. Let the device install the agent and complete provisioning.
8. Open the app and confirm:
   - `Device owner: true`
   - registration succeeded
   - workspace/device/customer match is correct
   - push token is available if Firebase is configured
9. From the admin panel, run one lock/unlock test.
10. Hand the phone to the customer only after the test passes.

## ADB Enrollment

Use ADB only for:

- internal testing
- repair bench work
- emergency reprovisioning by technical staff

Do not use ADB as the standard field process for customer handover.

## Rules For Existing Customer Phones

If a phone was already delivered without Device Owner enrollment:

- you do not have guaranteed control
- Android can still allow escape paths
- the only proper fix is to bring the phone back and reprovision it

There is no legitimate production-grade full-control path on standard Android without Device Owner provisioning.

## Required Business Policy

For every financed phone:

1. The device must be provisioned before delivery.
2. The customer must sign consent for device management and restriction policy.
3. The workspace admin must verify registration and lock/unlock behavior.
4. The provisioning QR must always use the correct workspace and device secret.

## Minimum Verification Checklist

Before handing over any phone, confirm:

- customer record exists
- contract exists
- device is enrolled
- device owner is true
- latest sync time is current
- push token exists or polling fallback is confirmed
- lock command works
- unlock command works
- support contact and lock message are correct for that workspace

## Recommended Near-Term Upgrade

When you are ready later:

- move from QR-only rollout to zero-touch for higher volume
- keep the same FinanceGuard workspace model and provisioning flow
- reuse the same backend and admin process
