import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } from '../src/permissions.js';

const EXPECTED_PERMISSIONS = [
  'invoice.view',
  'invoice.create',
  'invoice.edit',
  'invoice.cancel',
  'invoice.archive',
  'invoice.delete',
  'customer.view',
  'customer.create',
  'customer.edit',
  'payment.view',
  'payment.create',
  'formula.view',
  'formula.manage',
  'company.manage',
  'users.manage',
  'audit.view',
];

test("PERMISSIONS contains exactly the Phase 17/18/21 permission list", () => {
  assert.deepEqual([...PERMISSIONS].sort(), [...EXPECTED_PERMISSIONS].sort());
});

test('owner has every defined permission', () => {
  for (const permission of PERMISSIONS) {
    assert.ok(roleHasPermission('owner', permission), `owner should have ${permission}`);
  }
  assert.equal(ROLE_PERMISSIONS.owner.length, PERMISSIONS.length);
});

test('admin has every permission except users.manage', () => {
  for (const permission of PERMISSIONS) {
    if (permission === 'users.manage') {
      assert.equal(roleHasPermission('admin', permission), false);
    } else {
      assert.ok(roleHasPermission('admin', permission), `admin should have ${permission}`);
    }
  }
});

test('staff has operational permissions only — no company.manage, users.manage, invoice.edit/cancel/archive/delete', () => {
  const staffPermissions = new Set(ROLE_PERMISSIONS.staff);
  assert.ok(staffPermissions.has('invoice.view'));
  assert.ok(staffPermissions.has('invoice.create'));
  assert.ok(staffPermissions.has('customer.view'));
  assert.ok(staffPermissions.has('customer.create'));
  assert.ok(staffPermissions.has('customer.edit'));
  assert.ok(staffPermissions.has('payment.view'));
  assert.ok(staffPermissions.has('payment.create'));
  assert.ok(staffPermissions.has('formula.view'));
  assert.ok(staffPermissions.has('formula.manage'));

  assert.equal(staffPermissions.has('invoice.edit'), false);
  assert.equal(staffPermissions.has('invoice.cancel'), false);
  assert.equal(staffPermissions.has('invoice.archive'), false);
  assert.equal(staffPermissions.has('invoice.delete'), false);
  assert.equal(staffPermissions.has('company.manage'), false);
  assert.equal(staffPermissions.has('users.manage'), false);
  assert.equal(staffPermissions.has('audit.view'), false);
});

test('roleHasPermission is a plain lookup against ROLE_PERMISSIONS', () => {
  assert.equal(roleHasPermission('staff', 'formula.manage'), true);
  assert.equal(roleHasPermission('staff', 'company.manage'), false);
  assert.equal(roleHasPermission('admin', 'company.manage'), true);
});
