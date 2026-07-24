// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, any>> {
  private handlers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): () => void {
    (this.handlers[event] ??= new Set()).add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): void {
    this.handlers[event]?.delete(cb);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers[event]?.forEach((cb) => cb(payload));
  }

  clear(): void {
    this.handlers = {};
  }
}
