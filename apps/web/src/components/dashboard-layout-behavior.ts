type HorizontalScrollElement = {
  scrollLeft: number;
};

export function synchronizeScrollLeft(
  source: HorizontalScrollElement,
  target: HorizontalScrollElement
) {
  target.scrollLeft = source.scrollLeft;
}

export function parseSidebarCollapsedState(value: string | null) {
  return value === "true";
}
