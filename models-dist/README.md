# The package's speech model

This folder is what the package carries as `resources/models`
(`electron-builder.config.cjs`). The product ships **one** speech model: the
multilingual Whisper medium set, CPU pair (≈ 0.94 GB). It transcribes Turkish,
English and the other Whisper languages; the language is chosen in the app.

Nothing here is in git (model weights are hundreds of megabytes) except this
file. `npm run dist` / `npm run dist:dir` fill it: `scripts/package/models.mjs`
copies the multilingual files from `models/` (the development folder, which
also holds the English GPU pair used while developing). Nothing is downloaded.

The files are named after their download address, with the pinned revision in
the name (`MULTILINGUAL_REVISION` in `src/renderer/src/subtitles/models.ts`):

```
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_config.json
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_generation_config.json
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_preprocessor_config.json
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_tokenizer.json
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_tokenizer_config.json
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_onnx_encoder_model_quantized.onnx
huggingface.co_onnx-community_whisper-medium_timestamped_resolve_<revision>_onnx_decoder_model_merged_quantized.onnx
```

The multilingual model runs only on the CPU pair: its fp16 GPU decoder was
rejected because it returned invalid word times.

## Without a model

A package built with this folder empty works except Auto captions: the app
says the model is missing and names the folder to put one in
(`resources/models` beside the program).
