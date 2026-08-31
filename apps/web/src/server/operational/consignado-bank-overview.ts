export type OpenDifferenceOverview = { count: number; amount: string };
export type UnsettledOverview = { count: number; amount: string };

/**
 * Cada indicador de cabeçalho é opcional na tela: uma falha isolada vira "indisponível"
 * no card e não derruba o workspace, que é o dado essencial da conciliação.
 */
type OptionalLoader<Value> = { load: () => Promise<Value>; onFailure: (error: unknown) => void };

async function tolerated<Value>(loader: OptionalLoader<Value> | undefined) {
  if (!loader) return null;
  try { return await loader.load(); }
  catch (error) { loader.onFailure(error); return null; }
}

export async function loadBankReconciliationView<Workspace>(
  loadWorkspace: () => Promise<Workspace>,
  loadOverview: () => Promise<OpenDifferenceOverview>,
  onOverviewFailure: (error: unknown) => void,
  unsettled?: OptionalLoader<UnsettledOverview>,
) {
  const overviewPromise = tolerated({ load: loadOverview, onFailure: onOverviewFailure });
  const unsettledPromise = tolerated(unsettled);
  const [workspace, openDifferences, unsettledOverview] = await Promise.all([loadWorkspace(), overviewPromise, unsettledPromise]);
  return { workspace, openDifferences, unsettled: unsettledOverview };
}
