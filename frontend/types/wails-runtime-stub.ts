// Stub for the Wails runtime used in tests.
// The real /wails/runtime.js is injected by the Wails asset server.
export const Events = {
  On:   (_event: string, _cb: (e: any) => void) => () => {},
  Emit: (_event: string, ..._args: unknown[]) => {},
};
