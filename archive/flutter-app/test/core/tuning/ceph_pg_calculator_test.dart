import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/tuning/ceph_pg_calculator.dart';

void main() {
  const calculator = CephPgCalculator();

  test('rounds up to the nearest power of 2', () {
    final result = calculator.execute(
      const CephPgInput(
        osdCount: 20,
        poolCount: 1,
        targetPgsPerOsd: 100,
        replicationFactor: 3,
      ),
    );

    expect(result.rawPgCount, closeTo(666.67, 0.01));
    expect(result.roundedPgCount, 1024);
  });

  test('rejects non-positive inputs', () {
    expect(
      () => calculator.execute(
        const CephPgInput(
          osdCount: 0,
          poolCount: 1,
          targetPgsPerOsd: 100,
          replicationFactor: 3,
        ),
      ),
      throwsArgumentError,
    );
  });
}
