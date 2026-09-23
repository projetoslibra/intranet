export type FlatAverageResult = {
  average: number;
  periods: number;
  total: number;
  values: number[];
};

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculateFlatAverage(values: number[]): FlatAverageResult {
  const positiveValues = values.filter((value) => value > 0.005);

  if (positiveValues.length === 0) {
    return {
      average: 0,
      periods: 0,
      total: 0,
      values: [],
    };
  }

  if (positiveValues.length < 4) {
    const total = positiveValues.reduce((sum, value) => sum + value, 0);

    return {
      average: total / positiveValues.length,
      periods: positiveValues.length,
      total,
      values: positiveValues,
    };
  }

  const center = median(positiveValues);
  const deviations = positiveValues.map((value) => Math.abs(value - center));
  const medianDeviation = median(deviations);
  const tolerance =
    medianDeviation > 0
      ? medianDeviation * 4
      : Math.max(Math.abs(center) * 0.25, 1);
  const flatValues = positiveValues.filter(
    (value) => Math.abs(value - center) <= tolerance
  );
  const averageValues = flatValues.length > 0 ? flatValues : positiveValues;
  const total = averageValues.reduce((sum, value) => sum + value, 0);

  return {
    average: total / averageValues.length,
    periods: averageValues.length,
    total,
    values: averageValues,
  };
}
