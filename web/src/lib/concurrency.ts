/**
 * Utilitaires de concurrence bornée pour le process web unique (PM2 instances:1).
 *
 * Sans plafond, un fan-out (`Promise.all` sur N items) ou une rafale de tâches
 * fire-and-forget sature l'event loop et la RAM du seul process Node, ce qui
 * peut faire sauter `max_memory_restart` (OOM-restart PM2). Ces helpers lissent
 * la charge sans changer la sémantique métier (tout finit par s'exécuter).
 */

/**
 * Équivalent de `Promise.all(items.map(fn))` mais avec au plus `limit`
 * exécutions simultanées. Préserve l'ordre des résultats. Rejette à la première
 * erreur (comme `Promise.all`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const max = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(max, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Crée un limiteur qui n'exécute jamais plus de `max` tâches en parallèle.
 * Les tâches en excès sont mises en file et démarrent au fur et à mesure que des
 * créneaux se libèrent. Idéal pour borner des tâches de fond (fire-and-forget)
 * sur le process unique — la file fournit une backpressure naturelle.
 */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    active--;
    const start = queue.shift();
    if (start) start();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active++;
        fn().then(resolve, reject).finally(release);
      };
      if (active < limit) start();
      else queue.push(start);
    });
  };
}
