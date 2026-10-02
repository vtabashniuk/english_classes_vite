const compareNullableDateDesc = (leftValue, rightValue) => {
  const left = leftValue == null ? "" : String(leftValue);
  const right = rightValue == null ? "" : String(rightValue);

  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  return right.localeCompare(left);
};

const compareNullableTimestampDesc = (leftValue, rightValue) => {
  const left = leftValue ? new Date(leftValue).getTime() : Number.NEGATIVE_INFINITY;
  const right = rightValue ? new Date(rightValue).getTime() : Number.NEGATIVE_INFINITY;

  if (left === right) return 0;
  return right - left;
};

const compareNullableIdDesc = (leftValue, rightValue) => {
  const left = leftValue == null ? "" : String(leftValue);
  const right = rightValue == null ? "" : String(rightValue);

  return right.localeCompare(left);
};

export const sortFinanceOperationsNewestFirst = (
  items,
  {
    dateField = "payment_date",
    createdAtField = "created_at",
    idField = "payment_id",
  } = {},
) =>
  [...items].sort((left, right) => {
    const dateDifference = compareNullableDateDesc(
      left?.[dateField],
      right?.[dateField],
    );
    if (dateDifference !== 0) return dateDifference;

    const createdAtDifference = compareNullableTimestampDesc(
      left?.[createdAtField],
      right?.[createdAtField],
    );
    if (createdAtDifference !== 0) return createdAtDifference;

    return compareNullableIdDesc(left?.[idField], right?.[idField]);
  });
