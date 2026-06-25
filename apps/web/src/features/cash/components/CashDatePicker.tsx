"use client";

import { useRouter } from "next/navigation";

type CashDatePickerProps = {
  selectedDate: string;
  availableDates: string[];
};

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function CashDatePicker({ selectedDate, availableDates }: CashDatePickerProps) {
  const router = useRouter();

  function navigate(date: string) {
    if (date) {
      router.push(`/dashboard/caixa?date=${date}`);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700" htmlFor="cash-date">
          Data
        </label>
        <input
          className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          id="cash-date"
          onChange={(event) => navigate(event.target.value)}
          type="date"
          value={selectedDate}
        />
      </div>

      {availableDates.length > 0 ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700" htmlFor="cash-date-list">
            Datas com lançamento
          </label>
          <select
            className="h-10 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            id="cash-date-list"
            onChange={(event) => navigate(event.target.value)}
            value={availableDates.includes(selectedDate) ? selectedDate : ""}
          >
            <option disabled value="">
              Selecione uma data
            </option>
            {availableDates.map((date) => (
              <option key={date} value={date}>
                {formatDateLabel(date)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
