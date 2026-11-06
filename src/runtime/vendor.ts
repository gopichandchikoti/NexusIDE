import reactPackage from '../../node_modules/react/package.json';
import reactDomPackage from '../../node_modules/react-dom/package.json';

/** Versions of the libraries that page previews provide. Shown in the UI and written into templates. */
export const RUNTIME_VERSIONS = {
  react: reactPackage.version,
  'react-dom': reactDomPackage.version,
} as const;

export const REACT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
] as const;

export interface ReactVendor {
  readonly react: string;
  readonly reactDom: string;
}

/**
 * React is vendored (copied from node_modules at build time, no CDN) and loaded on demand.
 * The UMD files are not exposed by React's package `exports`, hence the relative paths.
 */
export async function loadReactVendor(): Promise<ReactVendor> {
  const [react, reactDom] = await Promise.all([
    import('../../node_modules/react/umd/react.production.min.js?raw'),
    import('../../node_modules/react-dom/umd/react-dom.production.min.js?raw'),
  ]);
  return { react: react.default, reactDom: reactDom.default };
}

/** Defines the object the bundler's `ext` lookup reads. Runs after the UMD scripts. */
export const EXTERNALS_DEFINITION = `var __NEXUS_EXTERNALS__=(function(){
var R=window.React,D=window.ReactDOM;
var jsx=function(t,p,k){return R.createElement(t,k===undefined?p:Object.assign({},p,{key:k}));};
var rt={jsx:jsx,jsxs:jsx,jsxDEV:jsx,Fragment:R.Fragment};
return{"react":R,"react-dom":D,"react-dom/client":D,"react/jsx-runtime":rt,"react/jsx-dev-runtime":rt};
})();`;
