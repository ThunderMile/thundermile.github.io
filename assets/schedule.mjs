const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric",
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function scheduledClass(entries, instant) {
  const parts = Object.fromEntries(chicago.formatToParts(instant).map(x => [x.type, x.value]));
  const date = parts.year + "-" + parts.month + "-" + parts.day;
  const time = parts.hour + ":" + parts.minute;
  const today = new Date(date + "T00:00:00Z");
  for (const entry of entries) {
    if (!entry.course || entry.start === entry.end) continue;
    // For a class spanning midnight, match the date and weekday of its start.
    const overnight = entry.start > entry.end;
    const afterMidnight = overnight && time < entry.end;
    const startDay = afterMidnight ? new Date(+today - 86_400_000) : today;
    const day = startDay.toISOString().slice(0, 10);
    const inTime = overnight ? time >= entry.start || afterMidnight : time >= entry.start && time < entry.end;
    if (!inTime) continue;
    const onDate = entry.date !== undefined ? day === entry.date :
      Array.isArray(entry.days) && entry.days.includes(startDay.getUTCDay()) &&
      day >= entry.semesterStart && day <= entry.semesterEnd && !entry.skipDates?.includes(day);
    if (onDate)
      return { kind: "class", label: "On my schedule · " + entry.course };
  }
  return null;
}
