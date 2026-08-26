import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/docker_run_converter.dart';
import 'package:yaml/yaml.dart';

void main() {
  const converter = DockerRunConverter();

  group('tokenizeDockerCommand', () {
    test('splits a simple command on whitespace', () {
      expect(tokenizeDockerCommand('docker run -d nginx'), ['docker', 'run', '-d', 'nginx']);
    });

    test('a naive split(\' \') would mangle a quoted value with spaces; the '
        'real tokenizer keeps it as one token', () {
      final tokens = tokenizeDockerCommand('run -e "FOO=bar baz" nginx');
      expect(tokens, ['run', '-e', 'FOO=bar baz', 'nginx']);
      // Proof the naive approach is wrong for this input.
      expect('run -e "FOO=bar baz" nginx'.split(' ').length, isNot(tokens.length));
    });

    test('single quotes are literal (no escape processing inside)', () {
      final tokens = tokenizeDockerCommand(r"run -e 'FOO=$bar baz\n' nginx");
      expect(tokens, ['run', '-e', r'FOO=$bar baz\n', 'nginx']);
    });

    test('double quotes process backslash escapes for " \\ \$ `', () {
      final tokens = tokenizeDockerCommand(r'run -e "say \"hi\" \$HOME \\ done" nginx');
      expect(tokens, ['run', '-e', r'say "hi" $HOME \ done', 'nginx']);
    });

    test('backslash-newline is a line continuation', () {
      final tokens = tokenizeDockerCommand('run \\\n  -d \\\n  nginx');
      expect(tokens, ['run', '-d', 'nginx']);
    });

    test('a Windows path backslash outside quotes survives literally', () {
      final tokens = tokenizeDockerCommand(r'run -v C:\data:/data nginx');
      expect(tokens, ['run', '-v', r'C:\data:/data', 'nginx']);
    });

    test('unterminated single quote throws FormatException', () {
      expect(() => tokenizeDockerCommand("run -e 'unterminated"), throwsFormatException);
    });

    test('unterminated double quote throws FormatException', () {
      expect(() => tokenizeDockerCommand('run -e "unterminated'), throwsFormatException);
    });
  });

  group('DockerRunConverter.execute - realistic multi-flag command', () {
    test('converts a representative docker run into compose YAML', () {
      final result = converter.execute(
        const DockerRunInput(
          command: 'docker run -d --name web -p 8080:80 -e "FOO=bar baz" '
              '-v webdata:/data --restart unless-stopped nginx:1.25',
        ),
      );

      expect(result.isValid, isTrue);
      expect(result.errorMessage, isNull);
      final yaml = result.yaml!;

      expect(yaml, contains('services:'));
      expect(yaml, contains('  web:'));
      expect(yaml, contains('image: nginx:1.25'));
      expect(yaml, contains('container_name: web'));
      expect(yaml, contains('restart: unless-stopped'));
      expect(yaml, contains('- "8080:80"'));
      expect(yaml, contains('- FOO=bar baz'));
      expect(yaml, contains('- webdata:/data'));
      expect(yaml, contains('volumes:'));
      expect(yaml, contains('  webdata:'));

      // -d/--detach produces a note, not a warning (it's a handled flag).
      expect(result.notes, isNotEmpty);
      expect(result.notes.any((n) => n.contains('detach')), isTrue);
    });

    test('quoted env values with embedded spaces survive into the emitted '
        'environment list verbatim', () {
      final result = converter.execute(
        const DockerRunInput(
          command: 'run -e "GREETING=hello world" -e \'OTHER=a b c\' alpine',
        ),
      );

      expect(result.isValid, isTrue);
      expect(result.yaml, contains('- GREETING=hello world'));
      expect(result.yaml, contains('- OTHER=a b c'));
    });
  });

  group('port mapping forms', () {
    test('host:container maps straight through, quoted', () {
      final result = converter.execute(const DockerRunInput(command: 'run -p 8080:80 nginx'));
      expect(result.yaml, contains('- "8080:80"'));
    });

    test('ip:host:container maps straight through, quoted', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run -p 127.0.0.1:8080:80 nginx'),
      );
      expect(result.yaml, contains('- "127.0.0.1:8080:80"'));
    });

    test('port/protocol suffix (udp) is preserved and quoted', () {
      final result = converter.execute(const DockerRunInput(command: 'run -p 53:53/udp dns'));
      expect(result.yaml, contains('- "53:53/udp"'));
    });

    test('a bare container port is preserved and quoted', () {
      final result = converter.execute(const DockerRunInput(command: 'run -p 80 nginx'));
      expect(result.yaml, contains('- "80"'));
    });

    test('an over-long port spec is flagged as a warning', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run -p a:b:c:d nginx'),
      );
      expect(result.warnings.any((w) => w.contains('unrecognised port specification')), isTrue);
    });
  });

  group('named volumes', () {
    test('a named volume produces both the service mount and the top-level '
        'volumes: block entry', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run -v mydata:/var/lib/data postgres'),
      );

      final yaml = result.yaml!;
      expect(yaml, contains('- mydata:/var/lib/data'));
      expect(yaml, contains('volumes:'));
      expect(yaml, contains('  mydata:'));
    });

    test('a bind-mount path source is NOT treated as a named volume', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run -v /host/data:/data postgres'),
      );

      final yaml = result.yaml!;
      expect(yaml, contains('- /host/data:/data'));
      expect(yaml, isNot(contains('volumes:\n  /host/data:')));
    });

    test('an anonymous volume (container path only) declares nothing at top level', () {
      final result = converter.execute(const DockerRunInput(command: 'run -v /data postgres'));
      expect(result.yaml, isNot(contains('\nvolumes:')));
    });

    test('a Windows-style bind source keeps the drive colon intact and is '
        'not mistaken for a named volume', () {
      final result = converter.execute(
        const DockerRunInput(command: r'run -v C:\data:/data postgres'),
      );
      final yaml = result.yaml!;
      expect(yaml, contains(r'C:\data:/data'));
      expect(yaml, isNot(contains('\nvolumes:')));
    });
  });

  group('unsupported flags surface as warnings', () {
    test('an unrecognised long flag is reported as ignored', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run --totally-made-up-flag=42 alpine'),
      );
      // `--flag=value` is split into name/value before hitting the default
      // case, so the warning renders space-separated, not with the `=`.
      expect(result.warnings, contains('ignored: --totally-made-up-flag 42'));
    });

    test('--mount is explicitly called out as unsupported', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run --mount type=bind,src=/a,dst=/b alpine'),
      );
      expect(result.warnings.any((w) => w.startsWith('ignored: --mount')), isTrue);
    });

    test('-P/--publish-all has no Compose equivalent and is warned about', () {
      final result = converter.execute(const DockerRunInput(command: 'run -P alpine'));
      expect(result.warnings.any((w) => w.contains('publish-all')), isTrue);
    });

    test('an unrecognised short flag is reported as ignored', () {
      final result = converter.execute(const DockerRunInput(command: 'run -z alpine'));
      expect(result.warnings.any((w) => w.contains('-z')), isTrue);
    });

    test('--gpus is called out as needing the Compose deploy syntax', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run --gpus all alpine'),
      );
      expect(result.warnings.any((w) => w.contains('--gpus')), isTrue);
    });
  });

  group('invalid input', () {
    test('empty command is rejected', () {
      final result = converter.execute(const DockerRunInput(command: ''));
      expect(result.isValid, isFalse);
      expect(result.yaml, isNull);
      expect(result.errorMessage, isNotNull);
    });

    test('a command with no image is rejected', () {
      final result = converter.execute(const DockerRunInput(command: 'docker run -d -p 8080:80'));
      expect(result.isValid, isFalse);
      expect(result.errorMessage, contains('IMAGE'));
    });

    test('unterminated quoting is surfaced as an error, not an exception', () {
      final result = converter.execute(const DockerRunInput(command: 'run -e "unterminated nginx'));
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });
  });

  group('emitted YAML re-parses cleanly via package:yaml', () {
    test('a complex multi-flag command produces valid, semantically correct YAML', () {
      final result = converter.execute(
        const DockerRunInput(
          command: 'docker run -d --name web '
              '-p 8080:80 -p 127.0.0.1:9000:9000 -p 53:53/udp '
              '-e "FOO=bar baz" -e SIMPLE=value '
              '-v webdata:/data -v /host/logs:/logs '
              '--network mynet --restart unless-stopped '
              '--memory 512m --cpus 1.5 '
              'nginx:1.25 nginx -g "daemon off;"',
        ),
      );

      expect(result.isValid, isTrue);
      final doc = loadYaml(result.yaml!) as YamlMap;

      final services = doc['services'] as YamlMap;
      final web = services['web'] as YamlMap;
      expect(web['image'], 'nginx:1.25');
      expect(web['container_name'], 'web');
      expect(web['restart'], 'unless-stopped');
      expect((web['ports'] as YamlList).toList(), ['8080:80', '127.0.0.1:9000:9000', '53:53/udp']);
      expect((web['environment'] as YamlList).toList(), ['FOO=bar baz', 'SIMPLE=value']);
      expect((web['volumes'] as YamlList).toList(), ['webdata:/data', '/host/logs:/logs']);
      expect((web['command'] as YamlList).toList(), ['nginx', '-g', 'daemon off;']);
      expect(web['cpus'], 1.5);
      expect(web['mem_limit'], '512m');

      final volumes = doc['volumes'] as YamlMap;
      expect(volumes.keys, contains('webdata'));

      final networks = doc['networks'] as YamlMap;
      expect(networks.keys, contains('mynet'));
      final mynet = networks['mynet'] as YamlMap;
      expect(mynet['external'], true);
    });

    test('a healthcheck command block re-parses to the expected shell test array', () {
      final result = converter.execute(
        const DockerRunInput(
          command: 'run --health-cmd "curl -f http://localhost/ || exit 1" '
              '--health-interval 30s --health-retries 3 alpine',
        ),
      );

      final doc = loadYaml(result.yaml!) as YamlMap;
      final service = (doc['services'] as YamlMap).values.first as YamlMap;
      final healthcheck = service['healthcheck'] as YamlMap;
      expect((healthcheck['test'] as YamlList).toList(), [
        'CMD-SHELL',
        'curl -f http://localhost/ || exit 1',
      ]);
      expect(healthcheck['interval'], '30s');
      expect(healthcheck['retries'], 3);
    });

    test('a port spec that looks like a base-60 YAML integer stays a quoted string', () {
      final result = converter.execute(const DockerRunInput(command: 'run -p 53:53 dns'));
      final doc = loadYaml(result.yaml!) as YamlMap;
      final service = (doc['services'] as YamlMap).values.first as YamlMap;
      final port = (service['ports'] as YamlList).first;
      expect(port, '53:53');
      expect(port, isA<String>());
    });
  });

  group('command prefix stripping', () {
    test('accepts a bare flag list with no docker/run prefix at all', () {
      final result = converter.execute(const DockerRunInput(command: '-d nginx'));
      expect(result.isValid, isTrue);
    });

    test('strips sudo docker run prefix', () {
      final result = converter.execute(const DockerRunInput(command: 'sudo docker run nginx'));
      expect(result.isValid, isTrue);
      final doc = loadYaml(result.yaml!) as YamlMap;
      final services = doc['services'] as YamlMap;
      expect((services['nginx'] as YamlMap)['image'], 'nginx');
    });

    test('strips podman run prefix', () {
      final result = converter.execute(const DockerRunInput(command: 'podman run alpine'));
      expect(result.isValid, isTrue);
    });
  });

  group('service naming', () {
    test('falls back to the image repository basename when --name is absent', () {
      final result = converter.execute(const DockerRunInput(command: 'run redis:7-alpine'));
      final doc = loadYaml(result.yaml!) as YamlMap;
      expect((doc['services'] as YamlMap).keys, contains('redis'));
    });

    test('strips the registry path down to the basename', () {
      final result = converter.execute(
        const DockerRunInput(command: 'run registry.example.com/team/myapp:latest'),
      );
      final doc = loadYaml(result.yaml!) as YamlMap;
      expect((doc['services'] as YamlMap).keys, contains('myapp'));
    });
  });
}
