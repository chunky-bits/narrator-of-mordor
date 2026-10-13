"""Expose Supertonic's text cross-attention maps for word timing (requires `pip install onnx`).

    python3 scripts/patch-supertonic.py public/models/supertonic/onnx/vector_estimator.onnx \
        public/models/supertonic/onnx/vector_estimator.timed.onnx

Adds the softmax outputs of two cross-attention layers (main_blocks.9 / .15, which align
latent frames to characters most cleanly) as extra graph outputs "attn9" and "attn15".
Weights are untouched; the extension only fetches these outputs on the last step.
"""
import sys

import onnx
from onnx import TensorProto, helper

LAYERS = {'main_blocks.9': 'attn9', 'main_blocks.15': 'attn15'}

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
graph = model.graph
found = 0
for node in list(graph.node):
    parts = node.name.split('/')
    if node.op_type == 'Softmax' and len(parts) > 4 and parts[4] == 'attn' and parts[3] in LAYERS:
        name = LAYERS[parts[3]]
        graph.node.append(helper.make_node('Identity', [node.output[0]], [name], name=f'{name}_out'))
        graph.output.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, ['heads', 'batch', 'frames', 'chars']))
        found += 1
if found != len(LAYERS):
    sys.exit(f'expected {len(LAYERS)} attention layers, found {found}')
onnx.checker.check_model(model)
onnx.save(model, dst)
print('patched', dst)
