export function dataAttributes(props: object): Record<string, string | number | boolean | undefined> {
  return Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
}
