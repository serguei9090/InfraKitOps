import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/base64_converter.dart';

void main() {
  const converter = Base64Converter();

  test('encodes text to Base64', () {
    final result = converter.execute(
      const Base64ConversionInput(text: 'InfraKit Studio', operation: Base64Operation.encode),
    );
    expect(result.output, 'SW5mcmFLaXQgU3R1ZGlv');
  });

  test('decodes Base64 back to text', () {
    final result = converter.execute(
      const Base64ConversionInput(text: 'SW5mcmFLaXQgU3R1ZGlv', operation: Base64Operation.decode),
    );
    expect(result.output, 'InfraKit Studio');
  });

  test('decodes Base64 pasted without padding', () {
    final result = converter.execute(
      const Base64ConversionInput(text: 'SGVsbG8', operation: Base64Operation.decode),
    );
    expect(result.output, 'Hello');
  });

  test('rejects invalid Base64 input', () {
    expect(
      () => converter.execute(
        const Base64ConversionInput(text: '@@@not base64@@@', operation: Base64Operation.decode),
      ),
      throwsFormatException,
    );
  });

  test('rejects empty decode input', () {
    expect(
      () => converter.execute(const Base64ConversionInput(text: '   ', operation: Base64Operation.decode)),
      throwsArgumentError,
    );
  });
}
