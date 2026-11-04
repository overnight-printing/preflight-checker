import { instantiate } from 'lcms-wasm';
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';

let enginePromise;

export function loadIccColorEngine() {
  if (!enginePromise) {
    enginePromise = instantiate({ locateFile: () => wasmUrl }).catch(error => {
      enginePromise = undefined;
      throw new Error(`Unable to load the ICC color engine. ${error.message}`);
    });
  }
  return enginePromise;
}
