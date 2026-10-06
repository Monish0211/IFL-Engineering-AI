import { indexPaths } from '../config';
import { VectorCollection } from './vector-store';

/** The two collections, opened once per server process (cached on globalThis to survive dev-mode hot reloads). */

type Stores = { knowledge: VectorCollection; uploads: VectorCollection };

const globalCache = globalThis as unknown as { __iflchatStores?: Promise<Stores> };

export function getStores(): Promise<Stores> {
  if (!globalCache.__iflchatStores) {
    globalCache.__iflchatStores = Promise.all([
      VectorCollection.open(indexPaths.knowledge),
      VectorCollection.open(indexPaths.uploads),
    ]).then(([knowledge, uploads]) => ({ knowledge, uploads }));
  }
  return globalCache.__iflchatStores;
}
