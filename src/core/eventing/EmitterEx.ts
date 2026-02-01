import { EventEmitter } from "eventemitter3";

export type EventListenerFilter<
  T extends EventEmitter.ValidEventTypes,
  K extends EventEmitter.EventNames<T>,
> = T extends string | symbol
  ? (...args: any[]) => void
  : (
      ...args: EventEmitter.ArgumentMap<Exclude<T, string | symbol>>[Extract<
        K,
        keyof T
      >]
    ) => boolean;

export class EmitterEx<
  EventTypes extends EventEmitter.ValidEventTypes = string | symbol,
> implements EventEmitter<EventTypes>
{
  private _emitter: EventEmitter<EventTypes>;
  constructor() {
    this._emitter = new EventEmitter<EventTypes>();
  }
  on<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    fn: EventEmitter.EventListener<EventTypes, U>
  ): this {
    this._emitter.on(event, fn);
    return this;
  }
  off<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    fn?: EventEmitter.EventListener<EventTypes, U>
  ): this {
    this._emitter.off(event, fn);
    return this;
  }
  emit<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    ...args: Parameters<EventEmitter.EventListener<EventTypes, U>>
  ): boolean {
    return this._emitter.emit(event, ...args);
  }
  once<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    fn: EventEmitter.EventListener<EventTypes, U>,
    options?: {
      filter?: EventListenerFilter<EventTypes, U>;
    }
  ): this {
    if (options?.filter) {
      const listener = ((...args: any[]) => {
        if ((options.filter as any)(...args)) {
          this.removeListener(
            event,
            listener as EventEmitter.EventListener<EventTypes, U>
          );
          (fn as any)(...args);
        }
      }) as EventEmitter.EventListener<EventTypes, U>;

      this.on(event, listener);
    } else {
      this._emitter.once(event, fn);
    }

    return this;
  }

  waitFor<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    options?: {
      filter?: EventListenerFilter<EventTypes, U>;
      timeout?: number;
    }
  ): Promise<Parameters<EventEmitter.EventListener<EventTypes, U>>> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.off(event, listener);
      };

      const listener = ((...args: any[]) => {
        if (!options?.filter || (options.filter as any)(...args)) {
          cleanup();
          resolve(
            args as Parameters<EventEmitter.EventListener<EventTypes, U>>
          );
        }
      }) as EventEmitter.EventListener<EventTypes, U>;

      if (options?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `waitFor('${String(event)}') timed out after ${options.timeout}ms`
            )
          );
        }, options.timeout);
      }

      this.on(event, listener);
    });
  }

  addListener<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    fn: EventEmitter.EventListener<EventTypes, U>
  ): this {
    this._emitter.addListener(event, fn);
    return this;
  }
  removeListener<U extends EventEmitter.EventNames<EventTypes>>(
    event: U,
    fn?: EventEmitter.EventListener<EventTypes, U>
  ): this {
    this._emitter.removeListener(event, fn);
    return this;
  }
  removeAllListeners(event?: EventEmitter.EventNames<EventTypes>): this {
    this._emitter.removeAllListeners(event);
    return this;
  }
  eventNames(): Array<EventEmitter.EventNames<EventTypes>> {
    return this._emitter.eventNames();
  }
  listeners<U extends EventEmitter.EventNames<EventTypes>>(
    event: U
  ): Array<EventEmitter.EventListener<EventTypes, U>> {
    return this._emitter.listeners(event);
  }
  listenerCount(event: EventEmitter.EventNames<EventTypes>): number {
    return this._emitter.listenerCount(event);
  }
}
