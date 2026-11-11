// A due date of "today" is the America/Detroit calendar day, including across
// midnight UTC when Detroit is still on the previous date.
export function detroitCalendarDate(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("invalid time");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => {
    const part = parts.find((item) => item.type === type);
    return part ? part.value : "";
  };
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
