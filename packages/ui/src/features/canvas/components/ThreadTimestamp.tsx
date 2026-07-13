import {
  ThreadItemTimestamp,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";

function ordinal(n: number): string {
  const rem = n % 100;
  const suffix = ["th", "st", "nd", "rd"];
  return `${n}${suffix[(rem - 20) % 10] ?? suffix[rem] ?? suffix[0]}`;
}

// "11:39pm" — locale-independent wall-clock: no leading zero on the hour,
// lowercase meridiem, no space. This is the label shown inline in the row.
function formatClock(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = date.getHours() >= 12 ? "pm" : "am";
  const hour12 = date.getHours() % 12 || 12;
  return `${hour12}:${minutes}${meridiem}`;
}

// "July 7th at 11:39pm" — full date + time for the hover tooltip.
function formatTooltip(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "long" });
  return `${month} ${ordinal(date.getDate())} at ${formatClock(date)}`;
}

// A ThreadItemHeader timestamp: shows the wall-clock time inline in the row
// ("11:39pm") and reveals the full date + time on hover ("July 7th at
// 11:39pm"). Carries its own TooltipProvider (context-only, no DOM) so it works
// anywhere a thread header is rendered without app-root setup.
export function ThreadTimestamp({ dateTime }: { dateTime: string }) {
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadItemTimestamp dateTime={dateTime}>
              {formatClock(date)}
            </ThreadItemTimestamp>
          }
        />
        <TooltipContent side="top">{formatTooltip(date)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
