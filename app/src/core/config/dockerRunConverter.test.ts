import { describe, expect, it } from 'vitest'
import { DockerRunConverter, tokenizeDockerCommand } from './dockerRunConverter'
import * as yaml from 'js-yaml'

describe('DockerRunConverter', () => {
  const converter = new DockerRunConverter()

  describe('tokenizeDockerCommand', () => {
    it('splits a simple command on whitespace', () => {
      expect(tokenizeDockerCommand('docker run -d nginx')).toEqual(['docker', 'run', '-d', 'nginx'])
    })

    it("a naive split(' ') would mangle a quoted value with spaces; the real tokenizer keeps it as one token", () => {
      const tokens = tokenizeDockerCommand('run -e "FOO=bar baz" nginx')
      expect(tokens).toEqual(['run', '-e', 'FOO=bar baz', 'nginx'])
      // Proof the naive approach is wrong for this input.
      expect('run -e "FOO=bar baz" nginx'.split(' ').length).not.toBe(tokens.length)
    })

    it('single quotes are literal (no escape processing inside)', () => {
      const tokens = tokenizeDockerCommand("run -e 'FOO=$bar baz\\n' nginx")
      expect(tokens).toEqual(['run', '-e', 'FOO=$bar baz\\n', 'nginx'])
    })

    it('double quotes process backslash escapes for " \\ $ `', () => {
      const tokens = tokenizeDockerCommand('run -e "say \\"hi\\" \\$HOME \\\\ done" nginx')
      expect(tokens).toEqual(['run', '-e', 'say "hi" $HOME \\ done', 'nginx'])
    })

    it('backslash-newline is a line continuation', () => {
      const tokens = tokenizeDockerCommand('run \\\n  -d \\\n  nginx')
      expect(tokens).toEqual(['run', '-d', 'nginx'])
    })

    it('a Windows path backslash outside quotes survives literally', () => {
      const tokens = tokenizeDockerCommand('run -v C:\\data:/data nginx')
      expect(tokens).toEqual(['run', '-v', 'C:\\data:/data', 'nginx'])
    })

    it('unterminated single quote throws', () => {
      expect(() => tokenizeDockerCommand("run -e 'unterminated")).toThrow()
    })

    it('unterminated double quote throws', () => {
      expect(() => tokenizeDockerCommand('run -e "unterminated')).toThrow()
    })
  })

  describe('DockerRunConverter.execute - realistic multi-flag command', () => {
    it('converts a representative docker run into compose YAML', () => {
      const result = converter.execute({
        command:
          'docker run -d --name web -p 8080:80 -e "FOO=bar baz" ' +
          '-v webdata:/data --restart unless-stopped nginx:1.25',
      })

      expect(result.isValid).toBe(true)
      expect(result.errorMessage).toBeUndefined()
      const yamlText = result.yaml!

      expect(yamlText).toContain('services:')
      expect(yamlText).toContain('  web:')
      expect(yamlText).toContain('image: nginx:1.25')
      expect(yamlText).toContain('container_name: web')
      expect(yamlText).toContain('restart: unless-stopped')
      expect(yamlText).toContain('- "8080:80"')
      expect(yamlText).toContain('- FOO=bar baz')
      expect(yamlText).toContain('- webdata:/data')
      expect(yamlText).toContain('volumes:')
      expect(yamlText).toContain('  webdata:')

      // -d/--detach produces a note, not a warning (it's a handled flag).
      expect(result.notes.length).toBeGreaterThan(0)
      expect(result.notes.some((n) => n.includes('detach'))).toBe(true)
    })

    it('quoted env values with embedded spaces survive into the emitted environment list verbatim', () => {
      const result = converter.execute({
        command: 'run -e "GREETING=hello world" -e \'OTHER=a b c\' alpine',
      })

      expect(result.isValid).toBe(true)
      expect(result.yaml).toContain('- GREETING=hello world')
      expect(result.yaml).toContain('- OTHER=a b c')
    })
  })

  describe('port mapping forms', () => {
    it('host:container maps straight through, quoted', () => {
      const result = converter.execute({ command: 'run -p 8080:80 nginx' })
      expect(result.yaml).toContain('- "8080:80"')
    })

    it('ip:host:container maps straight through, quoted', () => {
      const result = converter.execute({ command: 'run -p 127.0.0.1:8080:80 nginx' })
      expect(result.yaml).toContain('- "127.0.0.1:8080:80"')
    })

    it('port/protocol suffix (udp) is preserved and quoted', () => {
      const result = converter.execute({ command: 'run -p 53:53/udp dns' })
      expect(result.yaml).toContain('- "53:53/udp"')
    })

    it('a bare container port is preserved and quoted', () => {
      const result = converter.execute({ command: 'run -p 80 nginx' })
      expect(result.yaml).toContain('- "80"')
    })

    it('an over-long port spec is flagged as a warning', () => {
      const result = converter.execute({ command: 'run -p a:b:c:d nginx' })
      expect(result.warnings.some((w) => w.includes('unrecognised port specification'))).toBe(true)
    })
  })

  describe('named volumes', () => {
    it('a named volume produces both the service mount and the top-level volumes: block entry', () => {
      const result = converter.execute({ command: 'run -v mydata:/var/lib/data postgres' })

      const yamlText = result.yaml!
      expect(yamlText).toContain('- mydata:/var/lib/data')
      expect(yamlText).toContain('volumes:')
      expect(yamlText).toContain('  mydata:')
    })

    it('a bind-mount path source is NOT treated as a named volume', () => {
      const result = converter.execute({ command: 'run -v /host/data:/data postgres' })

      const yamlText = result.yaml!
      expect(yamlText).toContain('- /host/data:/data')
      expect(yamlText).not.toContain('volumes:\n  /host/data:')
    })

    it('an anonymous volume (container path only) declares nothing at top level', () => {
      const result = converter.execute({ command: 'run -v /data postgres' })
      expect(result.yaml).not.toContain('\nvolumes:')
    })

    it('a Windows-style bind source keeps the drive colon intact and is not mistaken for a named volume', () => {
      const result = converter.execute({ command: 'run -v C:\\data:/data postgres' })
      const yamlText = result.yaml!
      expect(yamlText).toContain('C:\\data:/data')
      expect(yamlText).not.toContain('\nvolumes:')
    })
  })

  describe('unsupported flags surface as warnings', () => {
    it('an unrecognised long flag is reported as ignored', () => {
      const result = converter.execute({ command: 'run --totally-made-up-flag=42 alpine' })
      // `--flag=value` is split into name/value before hitting the default
      // case, so the warning renders space-separated, not with the `=`.
      expect(result.warnings).toContain('ignored: --totally-made-up-flag 42')
    })

    it('--mount is explicitly called out as unsupported', () => {
      const result = converter.execute({ command: 'run --mount type=bind,src=/a,dst=/b alpine' })
      expect(result.warnings.some((w) => w.startsWith('ignored: --mount'))).toBe(true)
    })

    it('-P/--publish-all has no Compose equivalent and is warned about', () => {
      const result = converter.execute({ command: 'run -P alpine' })
      expect(result.warnings.some((w) => w.includes('publish-all'))).toBe(true)
    })

    it('an unrecognised short flag is reported as ignored', () => {
      const result = converter.execute({ command: 'run -z alpine' })
      expect(result.warnings.some((w) => w.includes('-z'))).toBe(true)
    })

    it('--gpus is called out as needing the Compose deploy syntax', () => {
      const result = converter.execute({ command: 'run --gpus all alpine' })
      expect(result.warnings.some((w) => w.includes('--gpus'))).toBe(true)
    })
  })

  describe('invalid input', () => {
    it('empty command is rejected', () => {
      const result = converter.execute({ command: '' })
      expect(result.isValid).toBe(false)
      expect(result.yaml).toBeUndefined()
      expect(result.errorMessage).toBeDefined()
    })

    it('a command with no image is rejected', () => {
      const result = converter.execute({ command: 'docker run -d -p 8080:80' })
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toContain('IMAGE')
    })

    it('unterminated quoting is surfaced as an error, not an exception', () => {
      const result = converter.execute({ command: 'run -e "unterminated nginx' })
      expect(result.isValid).toBe(false)
      expect(result.errorMessage).toBeDefined()
    })
  })

  describe('emitted YAML re-parses cleanly via js-yaml', () => {
    it('a complex multi-flag command produces valid, semantically correct YAML', () => {
      const result = converter.execute({
        command:
          'docker run -d --name web ' +
          '-p 8080:80 -p 127.0.0.1:9000:9000 -p 53:53/udp ' +
          '-e "FOO=bar baz" -e SIMPLE=value ' +
          '-v webdata:/data -v /host/logs:/logs ' +
          '--network mynet --restart unless-stopped ' +
          '--memory 512m --cpus 1.5 ' +
          'nginx:1.25 nginx -g "daemon off;"',
      })

      expect(result.isValid).toBe(true)
      const doc = yaml.load(result.yaml!) as any

      const web = doc.services.web
      expect(web.image).toBe('nginx:1.25')
      expect(web.container_name).toBe('web')
      expect(web.restart).toBe('unless-stopped')
      expect(web.ports).toEqual(['8080:80', '127.0.0.1:9000:9000', '53:53/udp'])
      expect(web.environment).toEqual(['FOO=bar baz', 'SIMPLE=value'])
      expect(web.volumes).toEqual(['webdata:/data', '/host/logs:/logs'])
      expect(web.command).toEqual(['nginx', '-g', 'daemon off;'])
      expect(web.cpus).toBe(1.5)
      expect(web.mem_limit).toBe('512m')

      expect(Object.keys(doc.volumes)).toContain('webdata')

      expect(Object.keys(doc.networks)).toContain('mynet')
      expect(doc.networks.mynet.external).toBe(true)
    })

    it('a healthcheck command block re-parses to the expected shell test array', () => {
      const result = converter.execute({
        command:
          'run --health-cmd "curl -f http://localhost/ || exit 1" ' +
          '--health-interval 30s --health-retries 3 alpine',
      })

      const doc = yaml.load(result.yaml!) as any
      const service = Object.values(doc.services)[0] as any
      const healthcheck = service.healthcheck
      expect(healthcheck.test).toEqual(['CMD-SHELL', 'curl -f http://localhost/ || exit 1'])
      expect(healthcheck.interval).toBe('30s')
      expect(healthcheck.retries).toBe(3)
    })

    it('a port spec that looks like a base-60 YAML integer stays a quoted string', () => {
      const result = converter.execute({ command: 'run -p 53:53 dns' })
      const doc = yaml.load(result.yaml!) as any
      const service = Object.values(doc.services)[0] as any
      const port = service.ports[0]
      expect(port).toBe('53:53')
      expect(typeof port).toBe('string')
    })
  })

  describe('command prefix stripping', () => {
    it('accepts a bare flag list with no docker/run prefix at all', () => {
      const result = converter.execute({ command: '-d nginx' })
      expect(result.isValid).toBe(true)
    })

    it('strips sudo docker run prefix', () => {
      const result = converter.execute({ command: 'sudo docker run nginx' })
      expect(result.isValid).toBe(true)
      const doc = yaml.load(result.yaml!) as any
      expect(doc.services.nginx.image).toBe('nginx')
    })

    it('strips podman run prefix', () => {
      const result = converter.execute({ command: 'podman run alpine' })
      expect(result.isValid).toBe(true)
    })
  })

  describe('service naming', () => {
    it('falls back to the image repository basename when --name is absent', () => {
      const result = converter.execute({ command: 'run redis:7-alpine' })
      const doc = yaml.load(result.yaml!) as any
      expect(Object.keys(doc.services)).toContain('redis')
    })

    it('strips the registry path down to the basename', () => {
      const result = converter.execute({ command: 'run registry.example.com/team/myapp:latest' })
      const doc = yaml.load(result.yaml!) as any
      expect(Object.keys(doc.services)).toContain('myapp')
    })
  })
})
