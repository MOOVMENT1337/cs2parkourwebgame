# Asset provenance

The first-person models in this directory were imported from two upstream
repositories at fixed commits.

## Knife models

- Source: [`dirtkiller23/cs2-weapon-animgraphs-rel`](https://github.com/dirtkiller23/cs2-weapon-animgraphs-rel)
- Commit: `8f09d6f33375a73e3fa2626dc31fec35bb257505`
- Imported content: all 22 FBX knife models and their first-person idle, draw,
  split inspect start/loop/end, and graph-referenced light/heavy miss DMX
  animation sources found under the upstream weapon directories
- Runtime note: DMX animation tracks are converted offline to compact JSON and
  reconstructed as Three.js clips in the browser
- Runtime note: the upstream tree did not contain matching skin texture images;
  the client preserves the factory material definitions embedded in the models

## Arms and gloves

- Source: [`goribby/CS2-MultiRig`](https://github.com/goribby/CS2-MultiRig)
- Commit: `026058b2a70a55257d6b85563f27b3c31e558f26`
- Imported content: six complete browser-ready glTF arms/glove sets (bare,
  fullfinger, fingerless, bloodhound, handwrap, and motorcycle), two CT Hard
  Knuckle variants, the CT SAS sleeves, their binary buffers, and every texture
  referenced by those glTF files

Neither upstream repository included a license file when these assets were
imported. Their use in this local project relies on the project owner's stated
permission from the relevant rights holder. Do not redistribute these files
without independently confirming the required rights.
