import { ulid } from 'ulidx'
import { v1 as uuidV1, v3 as uuidV3, v4 as uuidV4, v5 as uuidV5, validate as uuidValidate } from 'uuid'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Supported identifier kinds this generator can produce. */
export type IdKind = 'uuidV1' | 'uuidV3' | 'uuidV4' | 'uuidV5' | 'ulid'

/**
 * Well-known RFC 4122 namespace UUIDs, usable as `UuidUlidInput.namespace`
 * for v3/v5 generation. Callers may also supply any other valid UUID string
 * as a custom namespace.
 */
export const WellKnownNamespace = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
} as const

export interface UuidUlidInput {
  kind: IdKind
  /**
   * Required for `uuidV3` and `uuidV5`: the namespace UUID string (see
   * `WellKnownNamespace` for the RFC-provided ones).
   */
  namespace?: string
  /** Required for `uuidV3` and `uuidV5`: the name to hash. */
  name?: string
}

export interface UuidUlidResult {
  kind: IdKind
  value: string
}

/**
 * Generates UUIDs (v1/v3/v4/v5) and ULIDs.
 *
 * Ported from `lib/core/utility/uuid_ulid_generator.dart`, which hand-rolled
 * v3 because the Dart `uuid` package's v4.x line dropped its own v3
 * implementation. The npm `uuid` package (v14, used here) still ships v3
 * directly, so this port simply calls it — no hand-rolled MD5 construction
 * needed on this side.
 */
export class UuidUlidGenerator implements IToolUseCase<UuidUlidInput, UuidUlidResult> {
  execute(input: UuidUlidInput): UuidUlidResult {
    switch (input.kind) {
      case 'uuidV1':
        return { kind: input.kind, value: uuidV1() }
      case 'uuidV4':
        return { kind: input.kind, value: uuidV4() }
      case 'uuidV5':
        this.requireNamespaceAndName(input)
        return { kind: input.kind, value: uuidV5(input.name!, input.namespace!) }
      case 'uuidV3':
        this.requireNamespaceAndName(input)
        return { kind: input.kind, value: uuidV3(input.name!, input.namespace!) }
      case 'ulid':
        return { kind: input.kind, value: ulid() }
    }
  }

  private requireNamespaceAndName(input: UuidUlidInput): void {
    if (input.namespace == null || input.namespace.length === 0) {
      throw new Error(`namespace is required for ${input.kind}`)
    }
    if (input.name == null || input.name.length === 0) {
      throw new Error(`name is required for ${input.kind}`)
    }
    if (!uuidValidate(input.namespace)) {
      throw new Error('namespace must be a valid UUID string')
    }
  }
}
