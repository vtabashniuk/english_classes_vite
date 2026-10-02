import { supabase } from "../../../shared/api/supabaseClient";

export const getStudentFinanceOverview = async (studentId) => {
  const [settingsResult, rateResult, scheduledRatesResult, balancesResult] = await Promise.all([
    supabase
      .from("student_billing_settings")
      .select(
        "student_id, billing_currency, online_payments_enabled, charge_missed_lessons",
      )
      .eq("student_id", studentId)
      .maybeSingle(),
    supabase
      .from("student_current_lesson_rates")
      .select(
        "id, student_id, amount_minor, currency, effective_from, effective_to",
      )
      .eq("student_id", studentId)
      .maybeSingle(),
    supabase
      .from("student_scheduled_lesson_rates")
      .select(
        "id, student_id, amount_minor, currency, effective_from, effective_to",
      )
      .eq("student_id", studentId)
      .order("effective_from", { ascending: true }),
    supabase
      .from("student_finance_balances")
      .select("student_id, currency, balance_minor")
      .eq("student_id", studentId),
  ]);

  const error =
    settingsResult.error ||
    rateResult.error ||
    scheduledRatesResult.error ||
    balancesResult.error ||
    null;

  return {
    data: error
      ? null
      : {
          settings: settingsResult.data,
          currentRate: rateResult.data,
          scheduledRates: scheduledRatesResult.data ?? [],
          // Kept temporarily for compatibility with any older caller.
          nextRate: scheduledRatesResult.data?.[0] ?? null,
          balances: balancesResult.data ?? [],
        },
    error,
  };
};

export const getTeacherPaymentAccounts = async () =>
  supabase
    .from("payment_accounts")
    .select("id, name, provider, account_type, owner_type, currency, is_active")
    .eq("is_active", true)
    .order("currency", { ascending: true })
    .order("name", { ascending: true });

export const getStudentFinanceTransactions = async (
  studentId,
  { limit = 20, offset = 0, dateFrom = null, dateTo = null } = {},
) => {
  let transactionsQuery = supabase
    .from("student_finance_transaction_history")
    .select(
      "id, transaction_type, amount_minor, currency, lesson_id, payment_id, reversal_of_id, description, metadata, effective_at, effective_date, created_at, display_at, display_date",
      { count: "exact" },
    )
    .eq("student_id", studentId)
    .order("display_at", { ascending: false });

  if (dateFrom) transactionsQuery = transactionsQuery.gte("display_date", dateFrom);
  if (dateTo) transactionsQuery = transactionsQuery.lte("display_date", dateTo);

  const transactionsResult = await transactionsQuery.range(
    offset,
    offset + limit - 1,
  );

  if (transactionsResult.error) {
    return { data: null, error: transactionsResult.error };
  }

  const transactions = transactionsResult.data ?? [];
  const transactionIds = transactions.map((item) => item.id);
  const paymentIds = [...new Set(transactions.map((item) => item.payment_id).filter(Boolean))];

  let relations = [];

  if (transactionIds.length > 0) {
    const relationsResult = await supabase
      .from("student_finance_transaction_relations")
      .select(
        "transaction_id, relation_id, relation_type, relation_role, relation_created_at, source_student_id, target_student_id, original_payment_id, replacement_payment_id, reason_code, reason_note",
      )
      .in("transaction_id", transactionIds);

    if (relationsResult.error) {
      return { data: null, error: relationsResult.error };
    }

    relations = relationsResult.data ?? [];
  }

  let payments = [];

  if (paymentIds.length > 0) {
    const paymentsResult = await supabase
      .from("payments")
      .select(
        "id, payment_account_id, payment_method, provider, status, paid_at, description",
      )
      .in("id", paymentIds);

    if (paymentsResult.error) {
      return { data: null, error: paymentsResult.error };
    }

    payments = paymentsResult.data ?? [];
  }

  const accountIds = [
    ...new Set(payments.map((item) => item.payment_account_id).filter(Boolean)),
  ];

  let accounts = [];
  let taxAccruals = [];

  if (paymentIds.length > 0) {
    const taxResult = await supabase
      .from("payment_tax_accruals")
      .select(
        "payment_id, tax_profile_id, pe_group, income_date, source_amount_minor, source_currency, fx_source, fx_rate, fx_rate_date, tax_base_uah_minor, single_tax_basis, single_tax_rate, military_levy_basis, military_levy_rate, single_tax_minor, military_levy_minor, total_income_taxes_minor, status",
      )
      .in("payment_id", paymentIds);

    if (taxResult.error) {
      return { data: null, error: taxResult.error };
    }

    taxAccruals = taxResult.data ?? [];
  }

  if (accountIds.length > 0) {
    const accountsResult = await supabase
      .from("payment_accounts")
      .select("id, name, provider, account_type, owner_type, currency")
      .in("id", accountIds);

    if (accountsResult.error) {
      return { data: null, error: accountsResult.error };
    }

    accounts = accountsResult.data ?? [];
  }

  const relatedStudentIds = [
    ...new Set(
      relations
        .flatMap((item) => [item.source_student_id, item.target_student_id])
        .filter(Boolean),
    ),
  ];

  let relatedStudents = [];

  if (relatedStudentIds.length > 0) {
    const studentsResult = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", relatedStudentIds);

    if (studentsResult.error) {
      return { data: null, error: studentsResult.error };
    }

    relatedStudents = studentsResult.data ?? [];
  }

  const paymentsById = Object.fromEntries(payments.map((item) => [item.id, item]));
  const accountsById = Object.fromEntries(accounts.map((item) => [item.id, item]));
  const taxByPaymentId = Object.fromEntries(
    taxAccruals.map((item) => [item.payment_id, item]),
  );
  const relatedStudentsById = Object.fromEntries(
    relatedStudents.map((item) => [item.id, item]),
  );
  const relationsByTransactionId = relations.reduce((acc, item) => {
    const relation = {
      ...item,
      sourceStudent: item.source_student_id
        ? relatedStudentsById[item.source_student_id] ?? null
        : null,
      targetStudent: item.target_student_id
        ? relatedStudentsById[item.target_student_id] ?? null
        : null,
    };

    acc[item.transaction_id] = [...(acc[item.transaction_id] ?? []), relation];
    return acc;
  }, {});

  return {
    data: transactions.map((transaction) => {
      const payment = transaction.payment_id
        ? paymentsById[transaction.payment_id] ?? null
        : null;
      const paymentAccount = payment?.payment_account_id
        ? accountsById[payment.payment_account_id] ?? null
        : null;

      return {
        ...transaction,
        payment,
        paymentAccount,
        taxAccrual: transaction.payment_id
          ? taxByPaymentId[transaction.payment_id] ?? null
          : null,
        relations: relationsByTransactionId[transaction.id] ?? [],
      };
    }),
    error: null,
    count: transactionsResult.count ?? transactions.length,
  };
};

export const updateStudentBillingSettings = ({
  studentId,
  billingCurrency,
  onlinePaymentsEnabled = null,
  chargeMissedLessons = null,
}) =>
  supabase.rpc("update_student_billing_settings", {
    p_student_id: studentId,
    p_billing_currency: billingCurrency,
    p_online_payments_enabled: onlinePaymentsEnabled,
    p_charge_missed_lessons: chargeMissedLessons,
  });

export const setStudentLessonRate = ({
  studentId,
  amountMinor,
  currency,
  effectiveFrom,
}) =>
  supabase.rpc("set_student_lesson_rate", {
    p_student_id: studentId,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_effective_from: effectiveFrom,
  });


export const getMyCurrentTaxProfile = async () =>
  supabase
    .from("teacher_current_tax_profile")
    .select(
      "id, taxpayer_type, pe_group, single_tax_basis, single_tax_rate, military_levy_basis, military_levy_rate, esv_basis, esv_rate, effective_from, effective_to",
    )
    .maybeSingle();

export const getMyTaxProfiles = async () =>
  supabase
    .from("teacher_tax_profiles")
    .select(
      "id, taxpayer_type, pe_group, single_tax_basis, single_tax_rate, military_levy_basis, military_levy_rate, esv_basis, esv_rate, effective_from, effective_to",
    )
    .order("effective_from", { ascending: true });

export const getMyTaxParameters = async (date) =>
  supabase.rpc("get_my_tax_parameters", {
    p_on_date: date,
  });

export const getMyTaxParameterOverrides = async () =>
  supabase
    .from("teacher_tax_parameters")
    .select("id, code, value_numeric, unit, effective_from, effective_to")
    .order("effective_from", { ascending: true })
    .order("code", { ascending: true });

export const setMyTaxParameters = ({ effectiveFrom, values }) =>
  supabase.rpc("set_my_tax_parameters", {
    p_effective_from: effectiveFrom,
    p_values: values,
  });

export const setMyTaxProfile = ({
  taxpayerType,
  peGroup = null,
  effectiveFrom,
}) =>
  supabase.rpc("set_my_tax_profile", {
    p_taxpayer_type: taxpayerType,
    p_pe_group: peGroup,
    p_single_tax_rate: null,
    p_military_levy_rate: null,
    p_esv_rate: null,
    p_effective_from: effectiveFrom,
  });

export const createPaymentAccount = ({
  name,
  provider,
  accountType,
  ownerType,
  currency,
}) =>
  supabase.rpc("create_payment_account", {
    p_name: name,
    p_provider: provider,
    p_account_type: accountType,
    p_currency: currency,
    p_external_ref: null,
    p_owner_type: ownerType,
  });

export const updatePaymentAccountClassification = ({
  accountId,
  ownerType,
  accountType,
}) =>
  supabase.rpc("update_payment_account_classification", {
    p_account_id: accountId,
    p_owner_type: ownerType,
    p_account_type: accountType,
  });

export const resolvePaymentTax = (paymentId) =>
  supabase.functions.invoke("resolve-payment-tax", {
    body: { paymentId },
  });

export const refreshFinanceFxRates = (rateDate) =>
  supabase.functions.invoke("refresh-finance-fx-rates", {
    body: { rateDate },
  });

export const getTeacherMonthlyTaxSummary = async () =>
  supabase
    .from("teacher_monthly_tax_summary")
    .select(
      "month_start, income_base_uah_minor, single_tax_minor, military_levy_minor, esv_minor, total_tax_minor, pending_fx_count",
    )
    .order("month_start", { ascending: false });

export const getTeacherFinanceReceipts = async ({ dateFrom, dateTo }) => {
  let query = supabase
    .from("teacher_finance_receipts")
    .select(
      "payment_id, student_id, student_name, student_email, payment_account_id, account_name, owner_type, account_type, amount_minor, currency, payment_method, provider, paid_at, payment_date, payment_month, description, reporting_uah_minor, direct_tax_uah_minor, allocated_fixed_tax_uah_minor, net_income_uah_minor, profitability_status",
    )
    .order("payment_date", { ascending: false })
    .order("paid_at", { ascending: false });

  if (dateFrom) query = query.gte("payment_date", dateFrom);
  if (dateTo) query = query.lte("payment_date", dateTo);

  return query;
};


export const getTeacherStudentFinanceHealth = async () =>
  supabase
    .from("teacher_student_finance_health")
    .select(
      "student_id, student_name, student_email, billing_currency, balance_minor, debt_minor, unpaid_lesson_count, current_rate_minor, current_rate_currency, coverage_currency, coverage_balance_minor, coverage_uses_fx, coverage_fx_pending, covered_scheduled_lessons, priced_upcoming_lessons, remaining_lesson_count",
    )
    .order("student_name", { ascending: true });

export const recordManualStudentPayment = ({
  studentId,
  amountMinor,
  currency,
  paymentAccountId,
  paymentMethod,
  description,
  paidAt,
  clientRequestId,
}) =>
  supabase.rpc("record_manual_student_payment", {
    p_student_id: studentId,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_payment_account_id: paymentAccountId,
    p_payment_method: paymentMethod,
    p_description: description || null,
    p_paid_at: paidAt,
    p_client_request_id: clientRequestId,
  });

export const correctManualStudentPayment = ({
  paymentId,
  amountMinor,
  currency,
  paymentAccountId,
  paymentMethod,
  description,
  paidAt,
  clientRequestId,
}) =>
  supabase.rpc("correct_manual_student_payment", {
    p_payment_id: paymentId,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_payment_account_id: paymentAccountId,
    p_payment_method: paymentMethod,
    p_description: description || null,
    p_paid_at: paidAt,
    p_client_request_id: clientRequestId,
  });

export const cancelManualStudentPayment = ({
  paymentId,
  reasonCode,
  reasonNote,
}) =>
  supabase.rpc("cancel_manual_student_payment", {
    p_payment_id: paymentId,
    p_reason_code: reasonCode,
    p_reason_note: reasonNote || null,
  });

export const transferManualStudentPayment = ({
  paymentId,
  targetStudentId,
  reasonCode,
  reasonNote,
  clientRequestId,
}) =>
  supabase.rpc("transfer_manual_student_payment", {
    p_payment_id: paymentId,
    p_target_student_id: targetStudentId,
    p_reason_code: reasonCode,
    p_reason_note: reasonNote || null,
    p_client_request_id: clientRequestId,
  });

