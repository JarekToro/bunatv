/**
 * Fixed-capacity FIFO map of recently sent RTP audio packets.
 * Used to service retransmit requests from the RAOP receiver when
 * packets are lost in transit over UDP.
 */
export class PacketFifo {
  readonly #maxSize: number;
  readonly #packets: Map<number, Buffer> = new Map();
  readonly #order: number[] = [];

  constructor(maxSize: number) {
    this.#maxSize = maxSize;
  }

  get(seqno: number): Buffer | undefined {
    return this.#packets.get(seqno);
  }

  set(seqno: number, packet: Buffer): void {
    if (this.#packets.has(seqno)) return;

    this.#packets.set(seqno, packet);
    this.#order.push(seqno);

    while (this.#order.length > this.#maxSize) {
      const oldest = this.#order.shift();
      if (oldest !== undefined) this.#packets.delete(oldest);
    }
  }

  has(seqno: number): boolean {
    return this.#packets.has(seqno);
  }

  get size(): number {
    return this.#packets.size;
  }

  clear(): void {
    this.#packets.clear();
    this.#order.length = 0;
  }
}
