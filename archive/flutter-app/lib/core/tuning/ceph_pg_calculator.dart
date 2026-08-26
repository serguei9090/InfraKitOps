import 'dart:math' as math;

import '../ports/i_tool_use_case.dart';

class CephPgInput {
  const CephPgInput({
    required this.osdCount,
    required this.poolCount,
    required this.targetPgsPerOsd,
    required this.replicationFactor,
  });

  final int osdCount;
  final int poolCount;
  final int targetPgsPerOsd;
  final int replicationFactor;
}

class CephPgResult {
  const CephPgResult({required this.rawPgCount, required this.roundedPgCount});

  /// (OSD count * target PGs per OSD) / replication factor / pool count.
  final double rawPgCount;

  /// Rounded up to the nearest power of 2, per Ceph best practice.
  final int roundedPgCount;
}

/// Ceph Placement Group calculator: power-of-2 rounding per Ceph's official
/// PG-count formula. Pure math, zero I/O, zero Flutter — lives in the core
/// so it is unit-testable in milliseconds and reusable by any UI adapter.
class CephPgCalculator implements IToolUseCase<CephPgInput, CephPgResult> {
  const CephPgCalculator();

  @override
  CephPgResult execute(CephPgInput input) {
    if (input.osdCount <= 0 || input.poolCount <= 0 || input.replicationFactor <= 0) {
      throw ArgumentError('osdCount, poolCount and replicationFactor must be positive');
    }

    final raw = (input.osdCount * input.targetPgsPerOsd) /
        input.replicationFactor /
        input.poolCount;

    final rounded = _nextPowerOfTwo(raw);

    return CephPgResult(rawPgCount: raw, roundedPgCount: rounded);
  }

  int _nextPowerOfTwo(double value) {
    if (value <= 1) return 1;
    return math.pow(2, (math.log(value) / math.log(2)).ceil()).toInt();
  }
}
