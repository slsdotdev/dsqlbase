export function counter() {
  let index = 1;

  return {
    next() {
      return index++;
    },
  };
}

export function escapeValue(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

export function escapeIdentifier(str: string): string {
  return `"${str.replace(/"/g, '""')}"`;
}
