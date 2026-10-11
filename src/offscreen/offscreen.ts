import { EngineHost } from '../engines/host';
import { ORT_WASM_PATHS } from '../engines/ort-wasm';
import type { EngineRequest } from '../shared/messages';

// This bundle is also loaded by onnxruntime-web's WASM worker threads; only the
// document itself serves requests.
if (typeof document !== 'undefined') {
  const host = new EngineHost({
    modelRoot: chrome.runtime.getURL('models/'),
    wasmPaths: ORT_WASM_PATHS,
  });

  chrome.runtime.onMessage.addListener((msg: EngineRequest, _sender, sendResponse) => {
    if (msg?.target !== 'offscreen') return false;
    host.handle(msg).then(sendResponse);
    return true;
  });
}
