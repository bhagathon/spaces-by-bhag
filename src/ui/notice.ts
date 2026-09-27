export interface Notice {
  text: string;
  action?: { label: string; run: () => Promise<unknown> };
}
