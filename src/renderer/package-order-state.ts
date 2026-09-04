export function createPackageOrderState() {
  let requestId = 0;
  let serverOrder: string[] = [];
  let pending: { id: number; order: string[]; confirmed: boolean } | null = null;

  const project = (incoming: string[]): string[] => {
    if (!pending) return incoming;
    const available = new Set(incoming);
    const order = pending.order.filter((id) => available.delete(id));
    order.push(...available);
    const matches = order.length === incoming.length && order.every((id, index) => id === incoming[index]);
    if (matches && pending.confirmed) pending = null;
    return matches ? incoming : order;
  };

  return {
    begin(order: string[]): number {
      pending = { id: ++requestId, order: [...order], confirmed: false };
      return requestId;
    },
    accept(incoming: string[]): string[] {
      serverOrder = incoming;
      return project(incoming);
    },
    confirm(id: number): void {
      if (pending?.id === id) pending.confirmed = true;
    },
    reject(id: number): string[] | null {
      if (pending?.id !== id) return null;
      pending = null;
      return serverOrder;
    }
  };
}
