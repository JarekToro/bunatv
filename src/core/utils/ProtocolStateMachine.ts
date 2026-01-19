import { EventEmitter } from 'eventemitter3'
import { ProtocolState } from '@/protocols/types/BaseProtocol.ts'

interface StateChangeEvents {
  'state-changed': (state: ProtocolState, previous: ProtocolState) => void
}
// TODO: Hate this, want to remove it but too tired.
export class ProtocolStateMachine extends EventEmitter<StateChangeEvents> {
  private _state = ProtocolState.Idle

  get state() {
    return this._state
  }
  get isReady() {
    return this._state === ProtocolState.Ready
  }

  setState(state: ProtocolState) {
    const previous = this._state
    this._state = state
    this.emit('state-changed', state, previous)
    return { previous, current: state }
  }

  assertState(expected: ProtocolState, operation: string) {
    if (this._state !== expected) {
      throw new Error(`Cannot ${operation} in state: ${this._state}`)
    }
  }
}
