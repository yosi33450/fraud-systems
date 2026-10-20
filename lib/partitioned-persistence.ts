import { assembleState, partitionPath, partitionState, PARTITION_MARKER } from "@/lib/state-partitions";
import { mergeStateChanges } from "@/lib/state-merge";
import type { PersistedOperationalState } from "@/lib/operational-store";

export type CipherRecord = {ciphertext: string; iv: string; auth_tag: string};
export type PartitionRecord = CipherRecord & {id: string};
type Transport = {
  rpc: (name: string, args: unknown) => Promise<unknown>;
  encrypt: (value: unknown) => CipherRecord;
  decrypt: <T>(record: CipherRecord) => T;
};

export class PartitionedPersistence {
  private cache = new Map<string, PartitionRecord>();
  private values = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private transport: Transport;
  constructor(transport: Transport) { this.transport=transport; }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next;
    return next;
  }

  load(): Promise<PersistedOperationalState> {
    return this.serial(async () => {
      const known = Object.fromEntries([...this.cache].map(([id,row]) => [id,row.iv]));
      const rows = await this.transport.rpc("shopshield_read_parts", {known}) as PartitionRecord[];
      // Decode all before publishing any new cache state. A corrupt/missing
      // response must never turn into an empty successful dashboard.
      const cache = new Map(this.cache), values = new Map(this.values);
      for (const row of rows) {
        cache.set(row.id,row);
        if (row.id !== PARTITION_MARKER) values.set(row.id,this.transport.decrypt(row));
      }
      if (!cache.has(PARTITION_MARKER)) throw new Error("PERSISTENCE_PARTITIONS_NOT_READY");
      const state = assembleState(values);
      this.cache=cache; this.values=values;
      return state;
    });
  }

  save(base: PersistedOperationalState, local: PersistedOperationalState): Promise<void> {
    return this.serial(async () => {
      const before=partitionState(base), after=partitionState(local);
      const dirty=[...after.keys()].filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))).sort();
      if (!dirty.length) return;
      for (let attempt=0; attempt<4; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve,100+Math.random()*300*attempt));
        const rows=await this.transport.rpc("shopshield_read_dirty_parts",{ids:dirty}) as PartitionRecord[];
        const remote=new Map(rows.map(row => [row.id,row]));
        const changes=dirty.map(id => {
          const row=remote.get(id);
          if (!row) throw new Error("PERSISTENCE_PARTITION_MISSING");
          const merged=mergeStateChanges(before.get(id),after.get(id),this.transport.decrypt(row),partitionPath(id));
          return {id,expected_iv:row.iv,...this.transport.encrypt(merged)};
        });
        // One database transaction checks every revision before writing any
        // part: orders, alert, delivery status and dedup IDs commit together.
        const committed=await this.transport.rpc("shopshield_commit_parts",{changes});
        if (committed === true) return;
        if (committed !== false) throw new Error("PERSISTENCE_COMMIT_INVALID_RESPONSE");
      }
      throw new Error("PERSISTENCE_CONCURRENT_WRITE_RETRY");
    });
  }
}
