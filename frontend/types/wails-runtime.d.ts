// Type declarations for the Wails v3 runtime injected at /wails/runtime.js.
export declare const Events: {
  On(event: string, callback: (event: { data: unknown }) => void): () => void;
  Emit(event: string, ...data: unknown[]): void;
};
