import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/data_format_converter.dart';

void main() {
  const converter = DataFormatConverter();

  test('converts JSON to YAML', () {
    final result = converter.execute(
      const DataFormatConversionInput(
        source: '{"name": "InfraKit", "port": 8080, "tags": ["a", "b"]}',
        sourceFormat: DataFormat.json,
        targetFormat: DataFormat.yaml,
      ),
    );

    expect(result.output, contains('name: InfraKit'));
    expect(result.output, contains('port: 8080'));
    expect(result.output, contains('- a'));
    expect(result.output, contains('- b'));
  });

  test('converts YAML to JSON', () {
    final result = converter.execute(
      const DataFormatConversionInput(
        source: 'name: InfraKit\nport: 8080\n',
        sourceFormat: DataFormat.yaml,
        targetFormat: DataFormat.json,
      ),
    );

    expect(result.output, contains('"name": "InfraKit"'));
    expect(result.output, contains('"port": 8080'));
  });

  test('round-trips JSON through TOML', () {
    final result = converter.execute(
      const DataFormatConversionInput(
        source: '{"server": {"host": "localhost", "port": 8080}}',
        sourceFormat: DataFormat.json,
        targetFormat: DataFormat.toml,
      ),
    );

    expect(result.output, contains('[server]'));
    expect(result.output, contains('host ='));
    expect(result.output, contains('localhost'));

    final back = converter.execute(
      DataFormatConversionInput(
        source: result.output,
        sourceFormat: DataFormat.toml,
        targetFormat: DataFormat.json,
      ),
    );
    expect(back.output, contains('"host": "localhost"'));
    expect(back.output, contains('"port": 8080'));
  });

  test('round-trips JSON through XML', () {
    final result = converter.execute(
      const DataFormatConversionInput(
        source: '{"config": {"name": "svc", "enabled": true}}',
        sourceFormat: DataFormat.json,
        targetFormat: DataFormat.xml,
      ),
    );

    expect(result.output, contains('<config>'));
    expect(result.output, contains('<name>svc</name>'));

    final back = converter.execute(
      DataFormatConversionInput(
        source: result.output,
        sourceFormat: DataFormat.xml,
        targetFormat: DataFormat.json,
      ),
    );
    expect(back.output, contains('"name": "svc"'));
    expect(back.output, contains('"enabled": "true"'));
  });

  test('encodes XML attributes with the @ convention', () {
    final result = converter.execute(
      const DataFormatConversionInput(
        source: '<user id="42"><name>Ada</name></user>',
        sourceFormat: DataFormat.xml,
        targetFormat: DataFormat.json,
      ),
    );

    expect(result.output, contains('"@id": "42"'));
    expect(result.output, contains('"name": "Ada"'));
  });

  test('rejects empty input', () {
    expect(
      () => converter.execute(
        const DataFormatConversionInput(
          source: '   ',
          sourceFormat: DataFormat.json,
          targetFormat: DataFormat.yaml,
        ),
      ),
      throwsArgumentError,
    );
  });

  test('rejects malformed JSON input', () {
    expect(
      () => converter.execute(
        const DataFormatConversionInput(
          source: '{not valid json',
          sourceFormat: DataFormat.json,
          targetFormat: DataFormat.yaml,
        ),
      ),
      throwsFormatException,
    );
  });

  test('rejects a non-object root when encoding TOML', () {
    expect(
      () => converter.execute(
        const DataFormatConversionInput(
          source: '[1, 2, 3]',
          sourceFormat: DataFormat.json,
          targetFormat: DataFormat.toml,
        ),
      ),
      throwsFormatException,
    );
  });
}
