import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const canonicalizeExistingAncestor = (value: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolved = path.resolve(value);
    let existingAncestor = resolved;

    while (!(yield* fileSystem.exists(existingAncestor).pipe(Effect.orElseSucceed(() => false)))) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        return resolved;
      }
      existingAncestor = parent;
    }

    const canonicalAncestor = yield* fileSystem
      .realPath(existingAncestor)
      .pipe(Effect.orElseSucceed(() => existingAncestor));
    const missingSuffix = path.relative(existingAncestor, resolved);
    return missingSuffix === "" ? canonicalAncestor : path.join(canonicalAncestor, missingSuffix);
  });

export const resolvesInsideDirectory = (input: {
  readonly directory: string;
  readonly path: string;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const directory = yield* canonicalizeExistingAncestor(input.directory);
    const targetPath = yield* canonicalizeExistingAncestor(input.path);
    const relative = path.relative(directory, targetPath);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
