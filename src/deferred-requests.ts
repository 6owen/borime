export class DeferredRequests {
  private readonly texts = new Map<string, true>();

  rememberTop(batch: readonly string[]): void {
    const top = batch[0];
    if (top && !this.texts.has(top)) this.texts.set(top, true);
  }

  take(
    limit: number,
    known: ReadonlyMap<string, string>,
  ): string[] {
    for (const text of this.texts.keys()) {
      if (known.has(text)) this.texts.delete(text);
    }
    return [...this.texts.keys()].slice(0, limit);
  }

  complete(batch: readonly string[]): void {
    for (const text of batch) this.texts.delete(text);
  }
}
