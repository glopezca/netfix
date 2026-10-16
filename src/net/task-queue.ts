/** Binary min-heap of simulation tasks, ordered by time and then by insertion (seq): O(log n) push and pop. */
export interface Queued<T> {
  readonly time: number;
  readonly seq: number;
  readonly value: T;
}

const before = <T>(a: Queued<T>, b: Queued<T>): boolean => a.time < b.time || (a.time === b.time && a.seq < b.seq);

export class TaskQueue<T> {
  private readonly heap: Queued<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  peek(): Queued<T> | undefined {
    return this.heap[0];
  }

  push(item: Queued<T>): void {
    const h = this.heap;
    let i = h.push(item) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(item, h[parent]!)) break;
      h[i] = h[parent]!;
      i = parent;
    }
    h[i] = item;
  }

  pop(): Queued<T> | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (top === undefined || last === undefined || h.length === 0) return top;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      let best = last;
      if (l < h.length && before(h[l]!, best)) { m = l; best = h[l]!; }
      if (r < h.length && before(h[r]!, best)) { m = r; best = h[r]!; }
      if (m === i) break;
      h[i] = best;
      i = m;
    }
    h[i] = last;
    return top;
  }
}
