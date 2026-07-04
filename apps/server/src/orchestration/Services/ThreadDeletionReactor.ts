/**
 * ThreadDeletionReactor - Thread cleanup reactor service interface.
 *
 * Owns background workers that react to thread deletion/archive domain events
 * and perform best-effort runtime cleanup.
 *
 * @module ThreadDeletionReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * ThreadDeletionReactorShape - Service API for thread cleanup.
 */
export interface ThreadDeletionReactorShape {
  /**
   * Start reacting to thread.deleted/thread.archived orchestration domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * ThreadDeletionReactor - Service tag for thread cleanup workers.
 */
export class ThreadDeletionReactor extends Context.Service<
  ThreadDeletionReactor,
  ThreadDeletionReactorShape
>()("t3/orchestration/Services/ThreadDeletionReactor") {}
