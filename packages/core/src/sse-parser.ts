export interface SseEvent {
  event?: string;
  id?: string;
  data: unknown;
}

export class SseEventParser {
  private buffer = "";
  private currentEventName: string | null = null;
  private currentEventId: string | null = null;
  private currentData: string[] = [];

  parse(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    const events: SseEvent[] = [];

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line === "") {
        const event = this.flushEvent();
        if (event) {
          events.push(event);
        }
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("event:")) {
        this.currentEventName = line.slice(6).trim() || null;
        continue;
      }

      if (line.startsWith("id:")) {
        this.currentEventId = line.slice(3).trim() || null;
        continue;
      }

      if (line.startsWith("data:")) {
        this.currentData.push(line.slice(5).trimStart());
      }
    }

    return events;
  }

  reset(): void {
    this.buffer = "";
    this.currentEventName = null;
    this.currentEventId = null;
    this.currentData = [];
  }

  private flushEvent(): SseEvent | null {
    if (this.currentData.length === 0) {
      this.currentEventName = null;
      this.currentEventId = null;
      return null;
    }

    const rawData = this.currentData.join("\n");
    this.currentData = [];

    const id = this.currentEventId ?? undefined;
    const event = this.currentEventName ?? undefined;
    this.currentEventName = null;
    this.currentEventId = null;

    try {
      return { event, id, data: JSON.parse(rawData) };
    } catch {
      return null;
    }
  }
}
