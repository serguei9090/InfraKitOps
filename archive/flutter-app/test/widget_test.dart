import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/adapters/ui/shell/app_shell.dart';

void main() {
  testWidgets('dashboard shell shows the module taxonomy', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: InfraKitApp()));
    await tester.pumpAndSettle();

    expect(find.text('InfraKit Studio'), findsOneWidget);
    expect(find.text('Ceph PG Calculator'), findsOneWidget);
  });
}
