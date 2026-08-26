import { describe, expect, it } from 'vitest'
import { FirewallCommandBuilder, type FirewallCmdRule } from './firewallCommandBuilder'
import { PortRange } from './firewallRuleBuilder'

describe('FirewallCommandBuilder', () => {
  const builder = new FirewallCommandBuilder()

  const sshAllow: FirewallCmdRule = {
    action: 'allow',
    direction: 'inbound',
    protocol: 'tcp',
    ports: PortRange.single(22),
    source: '10.0.0.0/8',
    comment: 'ssh',
  }

  describe('iptables', () => {
    it('renders append + matching delete', () => {
      const cmd = builder.build(sshAllow, { provider: 'iptables' })
      expect(cmd.addCommand).toBe('iptables -A INPUT -p tcp --dport 22 -s 10.0.0.0/8 -j ACCEPT -m comment --comment "ssh"')
      expect(cmd.deleteCommand).toBe('iptables -D INPUT -p tcp --dport 22 -s 10.0.0.0/8 -j ACCEPT -m comment --comment "ssh"')
      expect(cmd.warnings).toHaveLength(0)
    })

    it('deny action renders DROP', () => {
      const rule: FirewallCmdRule = { action: 'deny', protocol: 'udp', ports: PortRange.single(53) }
      const cmd = builder.build(rule, { provider: 'iptables' })
      expect(cmd.addCommand).toContain('-j DROP')
      expect(cmd.addCommand).toContain('-p udp --dport 53')
    })
  })

  describe('firewalld', () => {
    it('renders rich-rule add/remove with reload', () => {
      const cmd = builder.build(sshAllow, { provider: 'firewalld' })
      expect(cmd.addCommand).toBe(
        `firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.0.0.0/8" port port="22" protocol="tcp" accept' && firewall-cmd --reload`,
      )
      expect(cmd.deleteCommand).toBe(
        `firewall-cmd --permanent --remove-rich-rule='rule family="ipv4" source address="10.0.0.0/8" port port="22" protocol="tcp" accept' && firewall-cmd --reload`,
      )
    })
  })

  describe('ufw', () => {
    it('renders allow + delete using same spec', () => {
      const cmd = builder.build(sshAllow, { provider: 'ufw' })
      expect(cmd.addCommand).toBe("ufw allow in from 10.0.0.0/8 to any port 22 proto tcp comment 'ssh'")
      expect(cmd.deleteCommand).toBe('ufw delete allow in from 10.0.0.0/8 to any port 22 proto tcp')
    })
  })

  describe('Windows PowerShell', () => {
    it('renders New-NetFirewallRule + Remove-NetFirewallRule', () => {
      const cmd = builder.build(sshAllow, { provider: 'windowsPowerShell' })
      expect(cmd.addCommand).toBe(
        'New-NetFirewallRule -DisplayName "infrakit-allow-22" -Direction Inbound -Protocol TCP -LocalPort 22 -RemoteAddress 10.0.0.0/8 -Action Allow',
      )
      expect(cmd.deleteCommand).toBe('Remove-NetFirewallRule -DisplayName "infrakit-allow-22"')
    })

    it('uses given rule name when provided', () => {
      const rule: FirewallCmdRule = { action: 'deny', ruleName: 'block-telnet', ports: PortRange.single(23) }
      const cmd = builder.build(rule, { provider: 'windowsPowerShell' })
      expect(cmd.addCommand).toContain('-DisplayName "block-telnet"')
      expect(cmd.addCommand).toContain('-Action Block')
    })
  })

  describe('Windows netsh', () => {
    it('renders add/delete rule', () => {
      const cmd = builder.build(sshAllow, { provider: 'windowsNetsh' })
      expect(cmd.addCommand).toBe(
        'netsh advfirewall firewall add rule name="infrakit-allow-22" dir=in action=allow protocol=TCP localport=22 remoteip=10.0.0.0/8',
      )
      expect(cmd.deleteCommand).toBe('netsh advfirewall firewall delete rule name="infrakit-allow-22"')
    })
  })

  describe('AWS Security Group', () => {
    it('renders authorize/revoke ingress with a real group id', () => {
      const cmd = builder.build(sshAllow, { provider: 'awsSecurityGroup', groupId: 'sg-0123456789abcdef0' })
      expect(cmd.addCommand).toBe('aws ec2 authorize-security-group-ingress --group-id sg-0123456789abcdef0 --protocol tcp --port 22 --cidr 10.0.0.0/8')
      expect(cmd.deleteCommand).toBe('aws ec2 revoke-security-group-ingress --group-id sg-0123456789abcdef0 --protocol tcp --port 22 --cidr 10.0.0.0/8')
      expect(cmd.warnings).toHaveLength(0)
    })

    it('deny action is unsupported and returns a caution warning instead of a real command', () => {
      const rule: FirewallCmdRule = { action: 'deny', ports: PortRange.single(22) }
      const cmd = builder.build(rule, { provider: 'awsSecurityGroup', groupId: 'sg-1' })
      expect(cmd.addCommand.startsWith('#')).toBe(true)
      expect(cmd.deleteCommand.startsWith('#')).toBe(true)
      expect(cmd.warnings).toHaveLength(1)
      expect(cmd.warnings[0].code).toBe('aws-deny-unsupported')
    })
  })

  describe('GCP Firewall Rule', () => {
    it('renders create/delete with default network', () => {
      const cmd = builder.build(sshAllow, { provider: 'gcpFirewall' })
      expect(cmd.addCommand).toBe(
        'gcloud compute firewall-rules create infrakit-allow-22 --network=default --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=10.0.0.0/8',
      )
      expect(cmd.deleteCommand).toBe('gcloud compute firewall-rules delete infrakit-allow-22 --quiet')
    })
  })

  describe('Azure NSG', () => {
    it('renders create/delete with default priority', () => {
      const cmd = builder.build(sshAllow, { provider: 'azureNsg', resourceGroup: 'rg1', nsgName: 'nsg1' })
      expect(cmd.addCommand).toBe(
        'az network nsg rule create --resource-group rg1 --nsg-name nsg1 --name infrakit-allow-22 --priority 100 --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 22 --source-address-prefixes 10.0.0.0/8',
      )
      expect(cmd.deleteCommand).toBe('az network nsg rule delete --resource-group rg1 --nsg-name nsg1 --name infrakit-allow-22')
    })

    it('honors an explicit priority', () => {
      const rule: FirewallCmdRule = { action: 'allow', ports: PortRange.single(443), priority: 200 }
      const cmd = builder.build(rule, { provider: 'azureNsg' })
      expect(cmd.addCommand).toContain('--priority 200')
    })
  })

  describe('port range formatting', () => {
    it('range ports use the dash spelling shared by nft/GCP/Azure/etc.', () => {
      const rule: FirewallCmdRule = { action: 'allow', ports: new PortRange(8000, 8010) }
      const cmd = builder.build(rule, { provider: 'gcpFirewall' })
      expect(cmd.addCommand).toContain('--rules=tcp:8000-8010')
    })
  })
})
