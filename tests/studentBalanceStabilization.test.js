import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getStudentBalanceDisplay } from '../src/features/finance/lib/studentBalance.js';
const src = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('student and teacher balance use the identical derived balance helper', () => {
  const student = src('src/pages/StudentBalance/StudentBalance.jsx');
  const teacher = src('src/pages/TeacherStudentDetails/TeacherStudentDetails.jsx');
  for (const code of [student, teacher]) assert.match(code, /getStudentBalanceDisplay\(/);
  assert.match(student, /getStudentFinanceOverview\(user.id, \{ teacherId: link.data.teacher_id \}\)/);
});

test('balance helper honors the exact active lesson currency and does not FX-combine', () => {
  assert.deepEqual(getStudentBalanceDisplay({
    currentRate: { currency: 'EUR' },
    settings: { billing_currency: 'UAH' },
    balances: [{ currency: 'EUR', balance_minor: -3500 }, { currency: 'UAH', balance_minor: 90000 }],
  }), { billingCurrency: 'EUR', primaryBalanceMinor: -3500, balancesByCurrency: { EUR: -3500, UAH: 90000 } });
  assert.equal(getStudentBalanceDisplay(null).primaryBalanceMinor, 0);
});

test('payment instructions require published active relationship and HTTPS URLs', () => {
  const sql = src('supabase/migrations/20261027120000_teacher_payment_instructions.sql');
  assert.match(sql, /rel\.is_active\s*=\s*true/);
  assert.match(sql, /rel\.student_id\s*=\s*\(select auth\.uid\(\)\)/);
  assert.match(sql, /is_published\s+and exists/);
  assert.match(sql, /teacher_id\s*=\s*\(select auth\.uid\(\)\)/);
  assert.match(sql, /teacher_payment_url_https/);
  assert.match(sql, /teacher_payment_qr_https/);
  const api = src('src/features/finance/api/paymentInstructionsApi.js');
  assert.match(api, /\.eq\("is_published", true\)/);
});
