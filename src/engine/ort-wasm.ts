// The ONNX Runtime WASM binary, emitted by Vite as an extension asset. The JS glue
// is already inlined in onnxruntime-web's bundle, so only the .wasm URL is needed.
// (Imported by relative path because the package's export map hides dist/.)
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

export const ORT_WASM_PATHS = { wasm: new URL(wasmUrl, location.href).href };
