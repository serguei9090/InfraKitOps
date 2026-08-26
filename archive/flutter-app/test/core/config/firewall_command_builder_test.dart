import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/firewall_command_builder.dart';
import 'package:infrakit_studio/core/config/firewall_rule_builder.dart' show PortRange, FirewallDirection, FirewallProtocol;

void main() {
  const builder = FirewallCommandBuilder();

  final sshAllow = FirewallCmdRule(
    action: FirewallCmdAction.allow,
    direction: FirewallDirection.inbound,
    protocol: FirewallProtocol.tcp,
    ports: PortRange.single(22),
    source: '10.0.0.0/8',
    comment: 'ssh',
  );

  group('iptables', () {
    test('renders append + matching delete', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.iptables));
      expect(cmd.addCommand, 'iptables -A INPUT -p tcp --dport 22 -s 10.0.0.0/8 -j ACCEPT -m comment --comment "ssh"');
      expect(cmd.deleteCommand, 'iptables -D INPUT -p tcp --dport 22 -s 10.0.0.0/8 -j ACCEPT -m comment --comment "ssh"');
      expect(cmd.warnings, isEmpty);
    });

    test('deny action renders DROP', () {
      final rule = FirewallCmdRule(action: FirewallCmdAction.deny, protocol: FirewallProtocol.udp, ports: PortRange.single(53));
      final cmd = builder.build(rule, const FirewallCmdContext(provider: FirewallCmdProvider.iptables));
      expect(cmd.addCommand, contains('-j DROP'));
      expect(cmd.addCommand, contains('-p udp --dport 53'));
    });
  });

  group('firewalld', () {
    test('renders rich-rule add/remove with reload', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.firewalld));
      expect(
        cmd.addCommand,
        "firewall-cmd --permanent --add-rich-rule='rule family=\"ipv4\" source address=\"10.0.0.0/8\" port port=\"22\" protocol=\"tcp\" accept' && firewall-cmd --reload",
      );
      expect(
        cmd.deleteCommand,
        "firewall-cmd --permanent --remove-rich-rule='rule family=\"ipv4\" source address=\"10.0.0.0/8\" port port=\"22\" protocol=\"tcp\" accept' && firewall-cmd --reload",
      );
    });
  });

  group('ufw', () {
    test('renders allow + delete using same spec', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.ufw));
      expect(cmd.addCommand, "ufw allow in from 10.0.0.0/8 to any port 22 proto tcp comment 'ssh'");
      expect(cmd.deleteCommand, 'ufw delete allow in from 10.0.0.0/8 to any port 22 proto tcp');
    });
  });

  group('Windows PowerShell', () {
    test('renders New-NetFirewallRule + Remove-NetFirewallRule', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.windowsPowerShell));
      expect(
        cmd.addCommand,
        'New-NetFirewallRule -DisplayName "infrakit-allow-22" -Direction Inbound -Protocol TCP -LocalPort 22 -RemoteAddress 10.0.0.0/8 -Action Allow',
      );
      expect(cmd.deleteCommand, 'Remove-NetFirewallRule -DisplayName "infrakit-allow-22"');
    });

    test('uses given rule name when provided', () {
      final rule = FirewallCmdRule(action: FirewallCmdAction.deny, ruleName: 'block-telnet', ports: PortRange.single(23));
      final cmd = builder.build(rule, const FirewallCmdContext(provider: FirewallCmdProvider.windowsPowerShell));
      expect(cmd.addCommand, contains('-DisplayName "block-telnet"'));
      expect(cmd.addCommand, contains('-Action Block'));
    });
  });

  group('Windows netsh', () {
    test('renders add/delete rule', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.windowsNetsh));
      expect(
        cmd.addCommand,
        'netsh advfirewall firewall add rule name="infrakit-allow-22" dir=in action=allow protocol=TCP localport=22 remoteip=10.0.0.0/8',
      );
      expect(cmd.deleteCommand, 'netsh advfirewall firewall delete rule name="infrakit-allow-22"');
    });
  });

  group('AWS Security Group', () {
    test('renders authorize/revoke ingress with a real group id', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.awsSecurityGroup, groupId: 'sg-0123456789abcdef0'));
      expect(cmd.addCommand, 'aws ec2 authorize-security-group-ingress --group-id sg-0123456789abcdef0 --protocol tcp --port 22 --cidr 10.0.0.0/8');
      expect(cmd.deleteCommand, 'aws ec2 revoke-security-group-ingress --group-id sg-0123456789abcdef0 --protocol tcp --port 22 --cidr 10.0.0.0/8');
      expect(cmd.warnings, isEmpty);
    });

    test('deny action is unsupported and returns a caution warning instead of a real command', () {
      final rule = FirewallCmdRule(action: FirewallCmdAction.deny, ports: PortRange.single(22));
      final cmd = builder.build(rule, const FirewallCmdContext(provider: FirewallCmdProvider.awsSecurityGroup, groupId: 'sg-1'));
      expect(cmd.addCommand, startsWith('#'));
      expect(cmd.deleteCommand, startsWith('#'));
      expect(cmd.warnings, hasLength(1));
      expect(cmd.warnings.single.code, 'aws-deny-unsupported');
    });
  });

  group('GCP Firewall Rule', () {
    test('renders create/delete with default network', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.gcpFirewall));
      expect(
        cmd.addCommand,
        'gcloud compute firewall-rules create infrakit-allow-22 --network=default --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=10.0.0.0/8',
      );
      expect(cmd.deleteCommand, 'gcloud compute firewall-rules delete infrakit-allow-22 --quiet');
    });
  });

  group('Azure NSG', () {
    test('renders create/delete with default priority', () {
      final cmd = builder.build(sshAllow, const FirewallCmdContext(provider: FirewallCmdProvider.azureNsg, resourceGroup: 'rg1', nsgName: 'nsg1'));
      expect(
        cmd.addCommand,
        'az network nsg rule create --resource-group rg1 --nsg-name nsg1 --name infrakit-allow-22 --priority 100 --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 22 --source-address-prefixes 10.0.0.0/8',
      );
      expect(cmd.deleteCommand, 'az network nsg rule delete --resource-group rg1 --nsg-name nsg1 --name infrakit-allow-22');
    });

    test('honors an explicit priority', () {
      final rule = FirewallCmdRule(action: FirewallCmdAction.allow, ports: PortRange.single(443), priority: 200);
      final cmd = builder.build(rule, const FirewallCmdContext(provider: FirewallCmdProvider.azureNsg));
      expect(cmd.addCommand, contains('--priority 200'));
    });
  });

  group('port range formatting', () {
    test('range ports use the dash spelling shared by nft/GCP/Azure/etc.', () {
      final rule = FirewallCmdRule(action: FirewallCmdAction.allow, ports: PortRange(8000, 8010));
      final cmd = builder.build(rule, const FirewallCmdContext(provider: FirewallCmdProvider.gcpFirewall));
      expect(cmd.addCommand, contains('--rules=tcp:8000-8010'));
    });
  });
}
