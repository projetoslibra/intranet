export type OpenDifferenceOverview = { count: number; amount: string };

export async function loadBankReconciliationView<Workspace>(
  loadWorkspace: () => Promise<Workspace>,
  loadOverview: () => Promise<OpenDifferenceOverview>,
  onOverviewFailure: (error: unknown) => void,
) {
  const overviewPromise = loadOverview().catch((error) => {
    onOverviewFailure(error);
    return null;
  });
  const [workspace, openDifferences] = await Promise.all([loadWorkspace(), overviewPromise]);
  return { workspace, openDifferences };
}
