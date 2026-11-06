/**
 * Deliberately small typings so React projects get completions without the full @types/react graph.
 * Everything not listed here is typed `any`; this is a documented limitation, not full React typing.
 */
export const REACT_TYPINGS = `
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [tag: string]: any }
}
declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = JSX.Element;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export interface RefObject<T> { current: T | null }
  export interface FC<P = {}> { (props: P): ReactElement | null }
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, Dispatch<A>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useContext<T>(context: Context<T>): T;
  export interface Context<T> { Provider: any; Consumer: any }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function memo<T>(component: T): T;
  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export const Fragment: any;
  export const StrictMode: any;
  const React: { createElement: typeof createElement; Fragment: any; StrictMode: any };
  export default React;
}
declare module 'react/jsx-runtime' {
  export function jsx(type: any, props: any, key?: any): JSX.Element;
  export function jsxs(type: any, props: any, key?: any): JSX.Element;
  export const Fragment: any;
}
declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): { render(node: any): void; unmount(): void };
}
declare module 'react-dom' {
  const ReactDOM: any;
  export default ReactDOM;
}
`;
