import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/adapters/ui/tools/form_flow_builder_screen.dart';

/// Regression coverage for FormFlow's nested "Dynamic Array Loop" support.
///
/// The bug these guard against: `_arrayScope` used to overwrite whatever the
/// values tree already held with a fresh empty list whenever the held value
/// wasn't already a `List`. Retyping a field to `array` in the designer left
/// a `Map` there (its parsed shape), so the overwrite blanked the form —
/// zero item blocks rendered and any values already entered at that level
/// were silently lost. Only the bare `[+ Add Item]` button survived, which
/// is exactly what a user hit when nesting one loop inside another.
void main() {
  /// A source document whose structure is already nested: an array
  /// (`clusters`) whose item template itself contains an array (`nodes`).
  const nestedJson = '''
{
  "app": "demo",
  "clusters": [
    { "name": "c1", "nodes": [ { "host": "h1", "port": "8080" } ] }
  ]
}
''';

  Future<void> pumpScreen(WidgetTester tester) async {
    // Wide enough that ToolDetailScaffold lays out its two panes side by
    // side (it switches to a stacked Column below 720px), so both the
    // designer and the live form are mounted at once.
    tester.view.physicalSize = const Size(1600, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(home: FormFlowBuilderScreen()));
    await tester.pumpAndSettle();
  }

  Future<void> parse(WidgetTester tester, String source) async {
    await tester.enterText(find.byType(TextField).first, source);
    await tester.tap(find.widgetWithText(FilledButton, 'Parse'));
    await tester.pumpAndSettle();
  }

  testWidgets('renders an [+ Add Item] affordance for BOTH the outer and the inner loop', (tester) async {
    await pumpScreen(tester);
    await parse(tester, nestedJson);

    // Both levels must be detected as arrays and rendered as loop blocks.
    expect(find.textContaining('clusters — Dynamic Array Loop'), findsOneWidget);
    expect(
      find.textContaining('nodes — Dynamic Array Loop'),
      findsOneWidget,
      reason: 'the inner array must render inside the outer array item, not be swallowed',
    );

    // One Add Item per loop. Before the fix the inner block rendered no
    // item content at all, so its fields were unreachable.
    expect(find.widgetWithText(OutlinedButton, 'Add Item'), findsNWidgets(2));
  });

  testWidgets('the inner loop pre-fills its parsed item rather than starting empty', (tester) async {
    await pumpScreen(tester);
    await parse(tester, nestedJson);

    // The inner item's own leaf fields must be present and carrying the
    // values that were parsed out of the source.
    expect(find.widgetWithText(TextField, 'h1'), findsOneWidget);
    expect(find.widgetWithText(TextField, '8080'), findsOneWidget);
  });

  testWidgets('tapping the inner [+ Add Item] adds another nested block', (tester) async {
    await pumpScreen(tester);
    await parse(tester, nestedJson);

    // 'host' labels one field per inner item; one item exists after parsing.
    expect(find.widgetWithText(TextField, 'h1'), findsOneWidget);

    // The inner loop's button is the second one in the tree (outer first).
    await tester.tap(find.widgetWithText(OutlinedButton, 'Add Item').last, warnIfMissed: false);
    await tester.pumpAndSettle();

    // A second inner block now exists: the original value plus one blank.
    final hostFields = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == 'host',
    );
    expect(hostFields, findsNWidgets(2), reason: 'Add Item on the inner loop must append a nested block');
  });

  testWidgets('generated output repeats the nested structure per item', (tester) async {
    await pumpScreen(tester);
    await parse(tester, nestedJson);

    // The live output pane renders through FormFlowParser.render, so the
    // nested array must survive the values tree round trip.
    expect(find.textContaining('"clusters"'), findsWidgets);
    expect(find.textContaining('h1'), findsWidgets);
  });

  testWidgets('a malformed source shows an inline parse error and never throws', (tester) async {
    await pumpScreen(tester);
    await parse(tester, '{ this is not valid json');

    expect(find.textContaining('Could not parse'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
