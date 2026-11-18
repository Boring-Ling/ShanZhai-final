# ASCII glass tiles background

Renderer and shader adapted from the public Rice-dog/code-codex ASCII Tiles effect:
https://github.com/Rice-dog/code-codex/tree/main/packages/explorer-ui/src/effects/ascii-tiles

Public visual reference: React Bits Pro ASCII Tiles.
https://pro.reactbits.dev/docs/components/ascii-tiles

This is the independent Code-Codex renderer, not the paid React Bits component source.

Local integration uses the existing standalone adaptation. The shader is resolved relative to the module; rendering stays behind the actual camera and feed. Dependencies are packaged locally. The renderer's pointer, reduced-motion, visibility and context-restoration behavior is retained.
