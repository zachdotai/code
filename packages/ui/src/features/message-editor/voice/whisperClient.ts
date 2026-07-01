// Main-thread handle to the whisper worker. A single lazily-created worker is
// shared across the app (the model is large — one resident copy is plenty). The
// client correlates each request with its resolving promise by id and transfers
// the PCM buffer into the worker to avoid a copy.

import type { WhisperRequest, WhisperResponse } from "./whisperTypes";

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

class WhisperClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./whisperEngine.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WhisperResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.type === "error") {
        entry.reject(new Error(message.message));
      } else if (message.type === "result") {
        entry.resolve(message.text);
      } else {
        entry.resolve("");
      }
    };
    worker.onerror = () => {
      // The worker script itself failed (e.g. failed to compile/load). Reject
      // everything in flight and drop it so the next call spins up a fresh one.
      this.rejectAll(new Error("Voice engine crashed."));
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private send(
    make: (id: number) => WhisperRequest,
    transfer?: Transferable[],
  ): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(make(id), transfer ?? []);
    });
  }

  // Spin up the worker and load the model ahead of the first real request, so
  // the initial transcription doesn't also pay the model-load cost.
  warmup(): Promise<void> {
    return this.send((id) => ({ type: "warmup", id })).then(() => undefined);
  }

  // Transcribe 16 kHz mono PCM. The backing ArrayBuffer is transferred, so the
  // caller must not reuse `pcm` afterwards.
  transcribe(pcm: Float32Array, lang: string): Promise<string> {
    return this.send(
      (id) => ({ type: "transcribe", id, pcm, lang }),
      [pcm.buffer],
    );
  }
}

let singleton: WhisperClient | null = null;

export function getWhisperClient(): WhisperClient {
  if (!singleton) singleton = new WhisperClient();
  return singleton;
}
