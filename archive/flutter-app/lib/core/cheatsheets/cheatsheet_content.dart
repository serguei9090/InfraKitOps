/// Pure-Dart content model + static reference data for the Cheatsheets &
/// Documentation Hub (spec Module 5). No Flutter imports here — this file is
/// data only, rendered by lib/adapters/ui/tools/cheatsheets_screen.dart.
///
/// Everything below is static/const on purpose: the app is client-first and
/// offline, so cheatsheet content ships in the binary instead of being
/// fetched over the network.
library;

/// A single reference row: a command/pattern/key on the left, what it does,
/// and a short worked example of using it.
class CheatsheetEntry {
  const CheatsheetEntry({
    required this.command,
    required this.description,
    required this.example,
  });

  /// The command, regex token, sysctl key, cron field/shortcut, or octal
  /// digit being documented. Rendered in [AppTheme.monospace] by the UI.
  final String command;

  /// Plain-language explanation of what it does.
  final String description;

  /// Short worked example (an invocation, a matched string, a config line).
  final String example;
}

/// A titled group of related [entries] within a [CheatsheetPage].
class CheatsheetSection {
  const CheatsheetSection({required this.title, required this.entries});

  final String title;
  final List<CheatsheetEntry> entries;
}

/// One full cheatsheet, e.g. "Git Commands" or "Chmod Permissions".
class CheatsheetPage {
  const CheatsheetPage({
    required this.id,
    required this.title,
    required this.description,
    required this.sections,
  });

  /// Stable slug for the currently-selected-page UI state — independent of
  /// [title] so a copy edit never breaks the "which page was open" state.
  final String id;

  final String title;

  /// One-line summary shown under the page title.
  final String description;

  final List<CheatsheetSection> sections;
}

/// What kind of thing an external resource actually is. This matters because
/// "official docs for a project" (documentation), "a GitHub repo that is
/// itself just a curated list of other links" (curatedList), "a hands-on
/// practice/exercise repo" (exercise), and "a structured learning path"
/// (roadmap) serve very different purposes even though they're all just a
/// name + URL on the surface.
enum ResourceType {
  /// Official project/product documentation (e.g. Kubernetes docs, Ceph docs).
  documentation,

  /// An "awesome-X" style repo whose content is itself a curated collection
  /// of links/resources, not documentation for a single project.
  curatedList,

  /// Hands-on practice material: exercises, challenges, interview prep repos.
  exercise,

  /// A structured learning path / roadmap for a domain or role.
  roadmap,
}

/// A curated external resource link (spec 5.2: External Resources). The UI
/// renders these as selectable text — see the doc comment on
/// CheatsheetsScreen for why they aren't tappable.
class ReferenceLink {
  const ReferenceLink({
    required this.name,
    required this.url,
    required this.description,
    required this.type,
    this.tags = const [],
  });

  final String name;
  final String url;
  final String description;

  /// Distinguishes official documentation from curated link lists, practice
  /// exercises, and roadmaps — the four kinds this section groups by.
  final ResourceType type;

  /// Free-form topic tags (e.g. 'devops', 'system-design') used to build the
  /// filter chips and to match against the search box in the UI.
  final List<String> tags;
}

// ---------------------------------------------------------------------------
// Git command cheatsheet
// ---------------------------------------------------------------------------

const _gitPage = CheatsheetPage(
  id: 'git',
  title: 'Git Commands',
  description: 'The commands people actually reach for, day to day.',
  sections: [
    CheatsheetSection(
      title: 'Setup & Cloning',
      entries: [
        CheatsheetEntry(
          command: 'git init',
          description: 'Initialize a new, empty Git repository in the current directory.',
          example: 'git init\ngit init my-project',
        ),
        CheatsheetEntry(
          command: 'git clone',
          description: 'Clone an existing repository into a new directory, copying its full history.',
          example: 'git clone https://github.com/user/repo.git',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Staging & Committing',
      entries: [
        CheatsheetEntry(
          command: 'git status',
          description: 'Show the working tree status: staged, unstaged, and untracked changes.',
          example: 'git status',
        ),
        CheatsheetEntry(
          command: 'git add',
          description: 'Stage file changes so they are included in the next commit.',
          example: 'git add file.txt\ngit add -A',
        ),
        CheatsheetEntry(
          command: 'git commit',
          description: 'Record the currently staged changes as a new commit in the history.',
          example: 'git commit -m "Fix login bug"',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Branching & Merging',
      entries: [
        CheatsheetEntry(
          command: 'git branch',
          description: 'List local branches, or create/delete one.',
          example: 'git branch feature-x\ngit branch -d feature-x',
        ),
        CheatsheetEntry(
          command: 'git checkout',
          description: 'Switch branches or restore working-tree files. Legacy multi-purpose command.',
          example: 'git checkout main\ngit checkout -- file.txt',
        ),
        CheatsheetEntry(
          command: 'git switch',
          description: 'Switch the current branch (Git 2.23+). Replaces checkout for branch switching.',
          example: 'git switch main\ngit switch -c new-feature',
        ),
        CheatsheetEntry(
          command: 'git merge',
          description: 'Join two or more development histories together into the current branch.',
          example: 'git merge feature-x',
        ),
        CheatsheetEntry(
          command: 'git rebase',
          description: 'Reapply commits from the current branch on top of another base commit.',
          example: 'git rebase main\ngit rebase -i HEAD~3',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Inspecting History',
      entries: [
        CheatsheetEntry(
          command: 'git log',
          description: 'Show commit history, most recent first.',
          example: 'git log --oneline --graph --decorate --all',
        ),
        CheatsheetEntry(
          command: 'git diff',
          description: 'Show changes between commits, the working tree, and the staging index.',
          example: 'git diff\ngit diff --staged',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Undoing Changes',
      entries: [
        CheatsheetEntry(
          command: 'git stash',
          description: 'Temporarily shelve uncommitted changes so you can work on something else.',
          example: 'git stash\ngit stash pop',
        ),
        CheatsheetEntry(
          command: 'git reset',
          description: 'Move the current branch tip and optionally reset the index/working tree.',
          example: 'git reset --soft HEAD~1\ngit reset --hard origin/main',
        ),
        CheatsheetEntry(
          command: 'git revert',
          description: 'Create a new commit that undoes the changes introduced by an earlier commit.',
          example: 'git revert abc1234',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Remote Repositories',
      entries: [
        CheatsheetEntry(
          command: 'git push',
          description: 'Upload local commits to a remote repository.',
          example: 'git push origin main',
        ),
        CheatsheetEntry(
          command: 'git pull',
          description: 'Fetch from a remote and integrate (merge or rebase) into the current branch.',
          example: 'git pull origin main\ngit pull --rebase',
        ),
        CheatsheetEntry(
          command: 'git fetch',
          description: 'Download objects and refs from a remote without merging them.',
          example: 'git fetch origin',
        ),
        CheatsheetEntry(
          command: 'git remote',
          description: 'Manage the set of tracked remote repositories.',
          example: 'git remote add origin https://github.com/user/repo.git\ngit remote -v',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Tagging',
      entries: [
        CheatsheetEntry(
          command: 'git tag',
          description: 'Create, list, or delete tags — typically used to mark release versions.',
          example: 'git tag v1.0.0\ngit tag -a v1.0.0 -m "Release 1.0"',
        ),
      ],
    ),
  ],
);

// ---------------------------------------------------------------------------
// Regex pattern cheatsheet
// ---------------------------------------------------------------------------

const _regexPage = CheatsheetPage(
  id: 'regex',
  title: 'Regex Patterns',
  description: 'Common metacharacters, classes, anchors, quantifiers, and groups.',
  sections: [
    CheatsheetSection(
      title: 'Character Classes',
      entries: [
        CheatsheetEntry(
          command: '.',
          description: 'Matches any single character except a newline (unless dotall mode is on).',
          example: 'a.c matches "abc" and "a1c", not "ac"',
        ),
        CheatsheetEntry(
          command: r'\d',
          description: 'Matches any digit, 0-9.',
          example: r'\d{3} matches "123"',
        ),
        CheatsheetEntry(
          command: r'\D',
          description: 'Matches any character that is not a digit.',
          example: r'\D+ matches "abc" in "abc123"',
        ),
        CheatsheetEntry(
          command: r'\w',
          description: 'Matches a word character: letters, digits, or underscore.',
          example: r'\w+ matches "hello_123"',
        ),
        CheatsheetEntry(
          command: r'\W',
          description: 'Matches any character that is not a word character.',
          example: r'\W matches "@" or " "',
        ),
        CheatsheetEntry(
          command: r'\s',
          description: 'Matches any whitespace character: space, tab, newline.',
          example: r'\s+ matches "   " (a run of spaces)',
        ),
        CheatsheetEntry(
          command: r'\S',
          description: 'Matches any non-whitespace character.',
          example: r'\S+ matches "hello" in "hello world"',
        ),
        CheatsheetEntry(
          command: '[...]',
          description: 'Character set: matches any one character listed (or a range) inside the brackets.',
          example: '[aeiou] matches any vowel; [a-z] matches a lowercase letter; [^0-9] matches a non-digit',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Anchors',
      entries: [
        CheatsheetEntry(
          command: '^',
          description: 'Matches the start of the string (or of a line, in multiline mode).',
          example: '^Hello matches "Hello world" only when "Hello" starts the string',
        ),
        CheatsheetEntry(
          command: r'$',
          description: 'Matches the end of the string (or of a line, in multiline mode).',
          example: r'world$ matches "Hello world" only when "world" ends the string',
        ),
        CheatsheetEntry(
          command: r'\b',
          description: 'Matches a word boundary: the position between a word character and a non-word character.',
          example: r'\bcat\b matches "cat" in "a cat sat", not in "category"',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Quantifiers',
      entries: [
        CheatsheetEntry(
          command: '*',
          description: 'Matches the preceding element zero or more times.',
          example: 'ab*c matches "ac", "abc", "abbbc"',
        ),
        CheatsheetEntry(
          command: '+',
          description: 'Matches the preceding element one or more times.',
          example: 'ab+c matches "abc" and "abbc", not "ac"',
        ),
        CheatsheetEntry(
          command: '?',
          description: 'Matches the preceding element zero or one time (makes it optional).',
          example: 'colou?r matches both "color" and "colour"',
        ),
        CheatsheetEntry(
          command: '{n,m}',
          description: 'Matches the preceding element between n and m times, inclusive.',
          example: r'\d{2,4} matches "12", "123", "1234"',
        ),
        CheatsheetEntry(
          command: '*? / +?',
          description: 'Lazy (non-greedy) quantifiers: match as few characters as possible.',
          example: '<.+?> on "<a><b>" matches "<a>", not the whole string',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Groups & Alternation',
      entries: [
        CheatsheetEntry(
          command: '(...)',
          description: 'Capturing group: groups a sub-pattern and captures the matched text.',
          example: '(ab)+ matches "ababab", capturing "ab"',
        ),
        CheatsheetEntry(
          command: '(?:...)',
          description: 'Non-capturing group: groups a sub-pattern without creating a capture.',
          example: '(?:ab)+ matches "ababab" with no capture group recorded',
        ),
        CheatsheetEntry(
          command: '|',
          description: 'Alternation: matches whatever is on its left or its right.',
          example: 'cat|dog matches "cat" or "dog"',
        ),
        CheatsheetEntry(
          command: '(?<name>...)',
          description: 'Named capturing group: captures a sub-match under a readable name.',
          example: r'(?<year>\d{4}) on "2024-01-01" captures group "year" as "2024"',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Lookaround',
      entries: [
        CheatsheetEntry(
          command: '(?=...)',
          description: 'Positive lookahead: matches a position only if followed by the pattern, without consuming it.',
          example: r'\d+(?=px) matches "100" in "100px"',
        ),
        CheatsheetEntry(
          command: '(?!...)',
          description: 'Negative lookahead: matches a position only if NOT followed by the pattern.',
          example: r'\d+(?!px) matches "100" in "100em" but not in "100px"',
        ),
        CheatsheetEntry(
          command: '(?<=...)',
          description: 'Positive lookbehind: matches a position only if preceded by the pattern.',
          example: r'(?<=\$)\d+ matches "100" in "\$100"',
        ),
        CheatsheetEntry(
          command: '(?<!...)',
          description: 'Negative lookbehind: matches a position only if NOT preceded by the pattern.',
          example: r'(?<!\$)\d+ matches "100" in "100 items" but not in "\$100"',
        ),
      ],
    ),
  ],
);

// ---------------------------------------------------------------------------
// Linux sysctl & kernel parameter reference
//
// Parameter names in the "Network (net.core.* / net.ipv4.*)" section are
// cross-checked against the keys this app actually generates in
// lib/core/tuning/linux_sysctl_tuner.dart (somaxconn, tcp_max_syn_backlog,
// tcp_tw_reuse, default_qdisc, tcp_congestion_control, rmem_max, wmem_max,
// tcp_rmem, tcp_wmem) rather than invented independently. The vm.*/fs.*/
// kernel.* entries broaden the reference beyond that tool's scope with other
// well-known, real sysctl keys.
// ---------------------------------------------------------------------------

const _sysctlPage = CheatsheetPage(
  id: 'sysctl',
  title: 'Linux Sysctl & Kernel Parameters',
  description: 'Real /proc/sys parameter names and what they control.',
  sections: [
    CheatsheetSection(
      title: 'Network Core (net.core.*)',
      entries: [
        CheatsheetEntry(
          command: 'net.core.somaxconn',
          description: 'Maximum length of the queue of pending (accepted but not yet handled) connections.',
          example: 'net.core.somaxconn = 8192',
        ),
        CheatsheetEntry(
          command: 'net.core.rmem_max',
          description: 'Maximum socket receive buffer size, in bytes, for all protocols.',
          example: 'net.core.rmem_max = 67108864',
        ),
        CheatsheetEntry(
          command: 'net.core.wmem_max',
          description: 'Maximum socket send buffer size, in bytes, for all protocols.',
          example: 'net.core.wmem_max = 67108864',
        ),
        CheatsheetEntry(
          command: 'net.core.default_qdisc',
          description: 'Default queuing discipline for network interfaces. "fq" is recommended alongside BBR.',
          example: 'net.core.default_qdisc = fq',
        ),
        CheatsheetEntry(
          command: 'net.core.netdev_max_backlog',
          description: 'Max packets queued on the input side when an interface receives faster than the kernel can process them.',
          example: 'net.core.netdev_max_backlog = 5000',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Network TCP (net.ipv4.*)',
      entries: [
        CheatsheetEntry(
          command: 'net.ipv4.tcp_max_syn_backlog',
          description: 'Maximum number of queued connection requests that have not yet been acknowledged by the client.',
          example: 'net.ipv4.tcp_max_syn_backlog = 8192',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_tw_reuse',
          description: 'Allow reusing sockets in TIME_WAIT state for new outgoing connections.',
          example: 'net.ipv4.tcp_tw_reuse = 1',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_congestion_control',
          description: 'TCP congestion control algorithm. "cubic" is the common default; "bbr" targets high-throughput links.',
          example: 'net.ipv4.tcp_congestion_control = bbr',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_rmem',
          description: 'Three values (min, default, max) for the TCP socket receive buffer, in bytes.',
          example: 'net.ipv4.tcp_rmem = 4096 87380 33554432',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_wmem',
          description: 'Three values (min, default, max) for the TCP socket send buffer, in bytes.',
          example: 'net.ipv4.tcp_wmem = 4096 65536 33554432',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_fin_timeout',
          description: 'Seconds to keep a socket in FIN-WAIT-2 state after the local end has closed it.',
          example: 'net.ipv4.tcp_fin_timeout = 30',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.ip_forward',
          description: 'Enables IP forwarding (routing packets between interfaces). Required on routers/gateways.',
          example: 'net.ipv4.ip_forward = 1',
        ),
        CheatsheetEntry(
          command: 'net.ipv4.tcp_keepalive_time',
          description: 'Seconds of connection idleness before the kernel starts sending TCP keepalive probes.',
          example: 'net.ipv4.tcp_keepalive_time = 600',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Virtual Memory (vm.*)',
      entries: [
        CheatsheetEntry(
          command: 'vm.swappiness',
          description: 'How aggressively the kernel swaps memory pages to disk, 0-100. Lower favors keeping data in RAM.',
          example: 'vm.swappiness = 10',
        ),
        CheatsheetEntry(
          command: 'vm.dirty_ratio',
          description: 'Percentage of RAM that can be filled with dirty (unwritten) pages before writing processes block.',
          example: 'vm.dirty_ratio = 20',
        ),
        CheatsheetEntry(
          command: 'vm.dirty_background_ratio',
          description: 'Percentage of RAM with dirty pages at which the kernel starts asynchronous background writeback.',
          example: 'vm.dirty_background_ratio = 10',
        ),
        CheatsheetEntry(
          command: 'vm.vfs_cache_pressure',
          description: 'How aggressively the kernel reclaims memory used for directory/inode object caches.',
          example: 'vm.vfs_cache_pressure = 50',
        ),
        CheatsheetEntry(
          command: 'vm.overcommit_memory',
          description: 'Controls kernel memory over-commit behavior: 0=heuristic, 1=always allow, 2=never overcommit.',
          example: 'vm.overcommit_memory = 1',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'File System (fs.*)',
      entries: [
        CheatsheetEntry(
          command: 'fs.file-max',
          description: 'System-wide maximum number of open file handles.',
          example: 'fs.file-max = 2097152',
        ),
        CheatsheetEntry(
          command: 'fs.inotify.max_user_watches',
          description: 'Maximum number of files a single user can watch via inotify (editors, build tools, file watchers).',
          example: 'fs.inotify.max_user_watches = 524288',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Kernel (kernel.*)',
      entries: [
        CheatsheetEntry(
          command: 'kernel.pid_max',
          description: 'Maximum process ID value the kernel will assign.',
          example: 'kernel.pid_max = 4194304',
        ),
        CheatsheetEntry(
          command: 'kernel.panic',
          description: 'Seconds to wait before automatically rebooting after a kernel panic. 0 disables auto-reboot.',
          example: 'kernel.panic = 10',
        ),
      ],
    ),
  ],
);

// ---------------------------------------------------------------------------
// Crontab syntax guide
// ---------------------------------------------------------------------------

const _crontabPage = CheatsheetPage(
  id: 'crontab',
  title: 'Crontab Syntax',
  description: 'The 5-field schedule format, special characters, shortcuts, and worked examples.',
  sections: [
    CheatsheetSection(
      title: 'The 5 Fields (minute hour day month weekday)',
      entries: [
        CheatsheetEntry(
          command: 'minute',
          description: 'Field 1. Valid values: 0-59.',
          example: '30 * * * * runs at the 30th minute of every hour',
        ),
        CheatsheetEntry(
          command: 'hour',
          description: 'Field 2. Valid values: 0-23.',
          example: '0 9 * * * runs at 9:00 AM every day',
        ),
        CheatsheetEntry(
          command: 'day of month',
          description: 'Field 3. Valid values: 1-31.',
          example: '0 0 1 * * runs at midnight on the 1st of every month',
        ),
        CheatsheetEntry(
          command: 'month',
          description: 'Field 4. Valid values: 1-12, or names Jan-Dec.',
          example: '0 0 1 6 * runs at midnight on June 1st',
        ),
        CheatsheetEntry(
          command: 'day of week',
          description: 'Field 5. Valid values: 0-7 (0 and 7 both mean Sunday), or names Sun-Sat.',
          example: '0 0 * * 1 runs at midnight every Monday',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Special Characters',
      entries: [
        CheatsheetEntry(
          command: '*',
          description: 'Matches every possible value for the field ("any").',
          example: '* * * * * runs every minute',
        ),
        CheatsheetEntry(
          command: ',',
          description: 'Value list separator: run at each listed value.',
          example: '0,15,30,45 * * * * runs at :00, :15, :30, and :45 of every hour',
        ),
        CheatsheetEntry(
          command: '-',
          description: 'Range of values, inclusive.',
          example: '0 9-17 * * * runs at the top of every hour from 9am through 5pm',
        ),
        CheatsheetEntry(
          command: '/',
          description: 'Step values: run every Nth value within a range (or within the full field range).',
          example: '*/15 * * * * runs every 15 minutes',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Nickname Shortcuts',
      entries: [
        CheatsheetEntry(
          command: '@reboot',
          description: 'Run once, at system startup.',
          example: '@reboot /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: '@yearly / @annually',
          description: 'Run once a year. Equivalent to "0 0 1 1 *".',
          example: '@yearly /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: '@monthly',
          description: 'Run once a month. Equivalent to "0 0 1 * *".',
          example: '@monthly /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: '@weekly',
          description: 'Run once a week. Equivalent to "0 0 * * 0".',
          example: '@weekly /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: '@daily / @midnight',
          description: 'Run once a day. Equivalent to "0 0 * * *".',
          example: '@daily /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: '@hourly',
          description: 'Run once an hour. Equivalent to "0 * * * *".',
          example: '@hourly /path/to/script.sh',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Worked Examples',
      entries: [
        CheatsheetEntry(
          command: 'Every 15 minutes',
          description: 'Run a job four times per hour, on the quarter hour.',
          example: '*/15 * * * * /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: 'Every weekday at 9am',
          description: 'Run once a day, Monday through Friday only.',
          example: '0 9 * * 1-5 /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: 'Every Sunday at midnight',
          description: 'A typical weekly backup schedule.',
          example: '0 0 * * 0 /path/to/backup.sh',
        ),
        CheatsheetEntry(
          command: 'First day of every month at 3am',
          description: 'A typical monthly maintenance/report schedule.',
          example: '0 3 1 * * /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: 'Every 5 minutes, business hours, weekdays',
          description: 'Combines a step value, an hour range, and a weekday range.',
          example: '*/5 9-17 * * 1-5 /path/to/script.sh',
        ),
        CheatsheetEntry(
          command: 'Twice a day at 6am and 6pm',
          description: 'Combines a value list in the hour field.',
          example: '0 6,18 * * * /path/to/script.sh',
        ),
      ],
    ),
  ],
);

// ---------------------------------------------------------------------------
// Chmod numeric permission matrix
// ---------------------------------------------------------------------------

const _chmodPage = CheatsheetPage(
  id: 'chmod',
  title: 'Chmod Permissions',
  description: 'The octal digit -> rwx mapping and common permission combinations.',
  sections: [
    CheatsheetSection(
      title: 'Octal Digit -> rwx',
      entries: [
        CheatsheetEntry(command: '0', description: 'No permissions.', example: '--- '),
        CheatsheetEntry(command: '1', description: 'Execute only.', example: '--x'),
        CheatsheetEntry(command: '2', description: 'Write only.', example: '-w-'),
        CheatsheetEntry(command: '3', description: 'Write and execute.', example: '-wx'),
        CheatsheetEntry(command: '4', description: 'Read only.', example: 'r--'),
        CheatsheetEntry(command: '5', description: 'Read and execute.', example: 'r-x'),
        CheatsheetEntry(command: '6', description: 'Read and write.', example: 'rw-'),
        CheatsheetEntry(command: '7', description: 'Read, write, and execute (full control).', example: 'rwx'),
      ],
    ),
    CheatsheetSection(
      title: 'How the Three Digits Work',
      entries: [
        CheatsheetEntry(
          command: '1st digit',
          description: 'Permissions for the file\'s owner (user).',
          example: 'chmod 7__ file  → owner gets rwx',
        ),
        CheatsheetEntry(
          command: '2nd digit',
          description: "Permissions for the file's group.",
          example: 'chmod _5_ file  → group gets r-x',
        ),
        CheatsheetEntry(
          command: '3rd digit',
          description: 'Permissions for everyone else (other/world).',
          example: 'chmod __4 file  → other gets r--',
        ),
      ],
    ),
    CheatsheetSection(
      title: 'Common Combinations',
      entries: [
        CheatsheetEntry(
          command: '644',
          description: 'rw-r--r--  Owner reads/writes; group and others read-only. The default for regular files (configs, text, HTML).',
          example: 'chmod 644 file.txt',
        ),
        CheatsheetEntry(
          command: '755',
          description: 'rwxr-xr-x  Owner has full control; group and others can read and execute. Standard for scripts and directories.',
          example: 'chmod 755 script.sh',
        ),
        CheatsheetEntry(
          command: '600',
          description: 'rw-------  Owner reads/writes; nobody else has any access. Common for private config/secret files.',
          example: 'chmod 600 .env',
        ),
        CheatsheetEntry(
          command: '700',
          description: 'rwx------  Owner has full control; nobody else has any access. Common for private scripts and directories.',
          example: 'chmod 700 ~/.ssh',
        ),
        CheatsheetEntry(
          command: '400',
          description: 'r--------  Owner read-only; nobody else has any access. Used for sensitive read-only files like SSH private keys.',
          example: 'chmod 400 id_rsa',
        ),
        CheatsheetEntry(
          command: '750',
          description: 'rwxr-x---  Owner has full control; group can read/execute; others have no access. Typical for group-shared scripts.',
          example: 'chmod 750 deploy.sh',
        ),
        CheatsheetEntry(
          command: '666',
          description: 'rw-rw-rw-  Everyone can read and write, nobody can execute. Rarely appropriate outside temp/shared scratch files.',
          example: 'chmod 666 shared_scratch.log',
        ),
        CheatsheetEntry(
          command: '777',
          description: 'rwxrwxrwx  Everyone has full control. Almost never the right answer in production — a common security anti-pattern.',
          example: 'chmod 777 file  # avoid — grants world write+execute',
        ),
      ],
    ),
  ],
);

const _httpStatusPage = CheatsheetPage(
  id: 'http-status',
  title: 'HTTP Status Codes',
  description: 'The status codes that actually show up in production, grouped by class.',
  sections: [
    CheatsheetSection(
      title: '1xx — Informational',
      entries: [
        CheatsheetEntry(command: '100', description: 'Continue — client should proceed with the request body.', example: 'Sent before a large POST body'),
        CheatsheetEntry(command: '101', description: 'Switching Protocols — server is switching per the client\'s Upgrade header.', example: 'HTTP → WebSocket upgrade'),
      ],
    ),
    CheatsheetSection(
      title: '2xx — Success',
      entries: [
        CheatsheetEntry(command: '200', description: 'OK — the standard successful response.', example: 'GET /users/1 → 200'),
        CheatsheetEntry(command: '201', description: 'Created — a new resource was created.', example: 'POST /users → 201 Location: /users/42'),
        CheatsheetEntry(command: '202', description: 'Accepted — request accepted for async processing, not yet complete.', example: 'Queued a background job'),
        CheatsheetEntry(command: '204', description: 'No Content — success, no response body.', example: 'DELETE /users/1 → 204'),
        CheatsheetEntry(command: '206', description: 'Partial Content — response to a Range request.', example: 'Resumable file download'),
      ],
    ),
    CheatsheetSection(
      title: '3xx — Redirection',
      entries: [
        CheatsheetEntry(command: '301', description: 'Moved Permanently — resource has a new permanent URL; clients should update links.', example: 'http:// → https:// redirect'),
        CheatsheetEntry(command: '302', description: 'Found — temporary redirect (historically often misused for what 303 means).', example: 'Post-login redirect'),
        CheatsheetEntry(command: '303', description: 'See Other — redirect after a POST; client should GET the new URL.', example: 'POST /orders → 303 /orders/42'),
        CheatsheetEntry(command: '304', description: 'Not Modified — cached response is still valid.', example: 'Conditional GET with If-None-Match'),
        CheatsheetEntry(command: '307', description: 'Temporary Redirect — like 302, but the method/body must NOT change.', example: 'Redirecting a POST without turning it into a GET'),
        CheatsheetEntry(command: '308', description: 'Permanent Redirect — like 301, but the method/body must NOT change.', example: 'API endpoint moved, same verb required'),
      ],
    ),
    CheatsheetSection(
      title: '4xx — Client Error',
      entries: [
        CheatsheetEntry(command: '400', description: 'Bad Request — malformed request syntax or invalid parameters.', example: 'Invalid JSON body'),
        CheatsheetEntry(command: '401', description: 'Unauthorized — authentication is required or has failed.', example: 'Missing/expired Bearer token'),
        CheatsheetEntry(command: '403', description: 'Forbidden — authenticated, but not allowed to access this resource.', example: 'Valid token, wrong role'),
        CheatsheetEntry(command: '404', description: 'Not Found — no resource at this URL.', example: 'GET /users/999999'),
        CheatsheetEntry(command: '405', description: 'Method Not Allowed — the URL exists but not for this HTTP method.', example: 'DELETE on a read-only endpoint'),
        CheatsheetEntry(command: '408', description: 'Request Timeout — server gave up waiting for the request.', example: 'Slow client, idle connection'),
        CheatsheetEntry(command: '409', description: 'Conflict — request conflicts with current server state.', example: 'Optimistic-lock version mismatch'),
        CheatsheetEntry(command: '410', description: 'Gone — resource existed but was permanently removed.', example: 'Deleted API version'),
        CheatsheetEntry(command: '413', description: 'Payload Too Large — request body exceeds server limits.', example: 'Upload bigger than nginx client_max_body_size'),
        CheatsheetEntry(command: '414', description: 'URI Too Long.', example: 'Excessively long query string'),
        CheatsheetEntry(command: '415', description: 'Unsupported Media Type — Content-Type not accepted by the server.', example: 'Sending XML to a JSON-only API'),
        CheatsheetEntry(command: '418', description: "I'm a Teapot — an April Fools' joke from RFC 2324, still occasionally implemented for fun.", example: 'Not meant to appear in real APIs'),
        CheatsheetEntry(command: '422', description: 'Unprocessable Entity — syntactically valid but semantically invalid (failed validation).', example: 'Required field missing after JSON parses fine'),
        CheatsheetEntry(command: '425', description: 'Too Early — server unwilling to risk processing a replayable early-data request.', example: 'TLS 1.3 0-RTT request'),
        CheatsheetEntry(command: '429', description: 'Too Many Requests — rate limit exceeded.', example: 'API throttling, check Retry-After header'),
        CheatsheetEntry(command: '431', description: 'Request Header Fields Too Large.', example: 'Oversized cookies/auth headers'),
        CheatsheetEntry(command: '451', description: 'Unavailable For Legal Reasons.', example: 'Content blocked by court order/DMCA'),
      ],
    ),
    CheatsheetSection(
      title: '5xx — Server Error',
      entries: [
        CheatsheetEntry(command: '500', description: 'Internal Server Error — generic unhandled server-side failure.', example: 'Unhandled exception in application code'),
        CheatsheetEntry(command: '501', description: 'Not Implemented — server doesn\'t support the requested functionality.', example: 'Unsupported HTTP method entirely'),
        CheatsheetEntry(command: '502', description: 'Bad Gateway — upstream server returned an invalid response.', example: 'nginx reverse proxy, backend crashed mid-request'),
        CheatsheetEntry(command: '503', description: 'Service Unavailable — server temporarily can\'t handle the request (overload/maintenance).', example: 'Deploy in progress, health check failing'),
        CheatsheetEntry(command: '504', description: 'Gateway Timeout — upstream server didn\'t respond in time.', example: 'Backend request exceeded proxy timeout'),
        CheatsheetEntry(command: '505', description: 'HTTP Version Not Supported.', example: 'Client requested an unsupported HTTP version'),
        CheatsheetEntry(command: '507', description: 'Insufficient Storage (WebDAV) — server out of space to complete the request.', example: 'Disk full on write'),
        CheatsheetEntry(command: '511', description: 'Network Authentication Required — client must authenticate to gain network access.', example: 'Captive portal (hotel/airport WiFi)'),
      ],
    ),
  ],
);

const _commonPortsPage = CheatsheetPage(
  id: 'common-ports',
  title: 'Common Ports',
  description: 'Well-known service ports an SRE runs into daily, grouped by category.',
  sections: [
    CheatsheetSection(
      title: 'Web',
      entries: [
        CheatsheetEntry(command: '80/tcp', description: 'HTTP.', example: 'Plaintext web traffic'),
        CheatsheetEntry(command: '443/tcp', description: 'HTTPS.', example: 'TLS-encrypted web traffic'),
        CheatsheetEntry(command: '3000/tcp', description: 'Common dev-server default (Node/Rails/many frameworks).', example: 'npm run dev'),
        CheatsheetEntry(command: '8080/tcp', description: 'Common alt-HTTP / app server port.', example: 'Tomcat, many reverse-proxied apps'),
        CheatsheetEntry(command: '8443/tcp', description: 'Common alt-HTTPS port.', example: 'Admin UIs behind a proxy'),
      ],
    ),
    CheatsheetSection(
      title: 'Mail',
      entries: [
        CheatsheetEntry(command: '25/tcp', description: 'SMTP — mail relay between servers.', example: 'MTA-to-MTA delivery'),
        CheatsheetEntry(command: '465/tcp', description: 'SMTPS — SMTP submission over implicit TLS.', example: 'Client-to-server submission'),
        CheatsheetEntry(command: '587/tcp', description: 'SMTP Submission — mail client to server, with STARTTLS.', example: 'Standard mail client config port'),
        CheatsheetEntry(command: '110/tcp', description: 'POP3.', example: 'Legacy mail retrieval'),
        CheatsheetEntry(command: '995/tcp', description: 'POP3S — POP3 over implicit TLS.', example: 'Encrypted POP3'),
        CheatsheetEntry(command: '143/tcp', description: 'IMAP.', example: 'Mail retrieval, server-side folders'),
        CheatsheetEntry(command: '993/tcp', description: 'IMAPS — IMAP over implicit TLS.', example: 'Encrypted IMAP'),
      ],
    ),
    CheatsheetSection(
      title: 'Databases',
      entries: [
        CheatsheetEntry(command: '3306/tcp', description: 'MySQL / MariaDB.', example: 'mysql -h host -P 3306'),
        CheatsheetEntry(command: '5432/tcp', description: 'PostgreSQL.', example: 'psql -h host -p 5432'),
        CheatsheetEntry(command: '6379/tcp', description: 'Redis.', example: 'redis-cli -h host -p 6379'),
        CheatsheetEntry(command: '27017/tcp', description: 'MongoDB.', example: 'mongosh host:27017'),
        CheatsheetEntry(command: '1521/tcp', description: 'Oracle Database (default listener).', example: 'TNS listener'),
      ],
    ),
    CheatsheetSection(
      title: 'Remote Access',
      entries: [
        CheatsheetEntry(command: '22/tcp', description: 'SSH — also used for SFTP and git-over-SSH.', example: 'ssh user@host'),
        CheatsheetEntry(command: '3389/tcp', description: 'RDP — Windows Remote Desktop.', example: 'mstsc /v:host'),
        CheatsheetEntry(command: '5900/tcp', description: 'VNC.', example: 'VNC viewer default'),
      ],
    ),
    CheatsheetSection(
      title: 'Infrastructure & Monitoring',
      entries: [
        CheatsheetEntry(command: '53/tcp+udp', description: 'DNS — TCP for zone transfers/large responses, UDP for normal queries.', example: 'dig @host, named/bind9'),
        CheatsheetEntry(command: '123/udp', description: 'NTP — time synchronization.', example: 'chronyd/ntpd'),
        CheatsheetEntry(command: '161/udp', description: 'SNMP — polling.', example: 'snmpwalk host'),
        CheatsheetEntry(command: '162/udp', description: 'SNMP Trap — async notifications.', example: 'Trap receiver listener'),
        CheatsheetEntry(command: '389/tcp', description: 'LDAP.', example: 'Directory bind/query'),
        CheatsheetEntry(command: '636/tcp', description: 'LDAPS — LDAP over implicit TLS.', example: 'Encrypted directory bind'),
        CheatsheetEntry(command: '111/tcp+udp', description: 'rpcbind/portmapper — required alongside NFS.', example: 'showmount -e host'),
        CheatsheetEntry(command: '2049/tcp+udp', description: 'NFS.', example: 'mount -t nfs host:/export /mnt'),
        CheatsheetEntry(command: '5672/tcp', description: 'AMQP — RabbitMQ default.', example: 'Message broker connections'),
        CheatsheetEntry(command: '9092/tcp', description: 'Kafka broker.', example: 'Producer/consumer connections'),
        CheatsheetEntry(command: '2379/tcp', description: 'etcd client API.', example: 'etcdctl --endpoints host:2379'),
        CheatsheetEntry(command: '2380/tcp', description: 'etcd peer (cluster) API.', example: 'etcd member-to-member traffic'),
        CheatsheetEntry(command: '6443/tcp', description: 'Kubernetes API server.', example: 'kubectl talks here'),
        CheatsheetEntry(command: '10250/tcp', description: 'Kubelet API.', example: 'Node agent, exec/logs traffic'),
        CheatsheetEntry(command: '9090/tcp', description: 'Prometheus (also a common generic app port — check context).', example: 'Prometheus web UI/API'),
        CheatsheetEntry(command: '9100/tcp', description: 'Prometheus node_exporter.', example: 'Host metrics scrape target'),
      ],
    ),
  ],
);

const _dockerPage = CheatsheetPage(
  id: 'docker',
  title: 'Docker Commands',
  description: 'Image and container lifecycle, volumes, networks, and Compose basics.',
  sections: [
    CheatsheetSection(
      title: 'Images',
      entries: [
        CheatsheetEntry(command: 'docker build', description: 'Build an image from a Dockerfile in the current directory.', example: 'docker build -t myapp:1.0 .'),
        CheatsheetEntry(command: 'docker images', description: 'List locally stored images.', example: 'docker images'),
        CheatsheetEntry(command: 'docker pull', description: 'Download an image from a registry.', example: 'docker pull nginx:alpine'),
        CheatsheetEntry(command: 'docker push', description: 'Upload an image to a registry.', example: 'docker push myrepo/myapp:1.0'),
        CheatsheetEntry(command: 'docker rmi', description: 'Remove one or more images.', example: 'docker rmi myapp:1.0'),
        CheatsheetEntry(command: 'docker tag', description: 'Create an additional tag for an existing image.', example: 'docker tag myapp:1.0 myapp:latest'),
      ],
    ),
    CheatsheetSection(
      title: 'Containers',
      entries: [
        CheatsheetEntry(command: 'docker run', description: 'Create and start a container from an image.', example: 'docker run -d -p 8080:80 --name web nginx'),
        CheatsheetEntry(command: 'docker ps', description: 'List running containers (-a for all, including stopped).', example: 'docker ps -a'),
        CheatsheetEntry(command: 'docker exec', description: 'Run a command inside a running container.', example: 'docker exec -it web sh'),
        CheatsheetEntry(command: 'docker logs', description: 'Show a container\'s stdout/stderr (-f to follow).', example: 'docker logs -f web'),
        CheatsheetEntry(command: 'docker stop / start / restart', description: 'Stop, start, or restart a container by name or ID.', example: 'docker stop web'),
        CheatsheetEntry(command: 'docker rm', description: 'Remove a stopped container.', example: 'docker rm web'),
        CheatsheetEntry(command: 'docker inspect', description: 'Show low-level JSON details (IP, mounts, env) for a container or image.', example: 'docker inspect web'),
      ],
    ),
    CheatsheetSection(
      title: 'Volumes & Networks',
      entries: [
        CheatsheetEntry(command: 'docker volume create/ls/rm', description: 'Manage named volumes for persistent data.', example: 'docker volume create dbdata'),
        CheatsheetEntry(command: '-v host:container', description: 'Bind-mount a host path into the container.', example: 'docker run -v /srv/data:/data nginx'),
        CheatsheetEntry(command: 'docker network create/ls/rm', description: 'Manage user-defined bridge networks so containers can resolve each other by name.', example: 'docker network create appnet'),
      ],
    ),
    CheatsheetSection(
      title: 'Compose',
      entries: [
        CheatsheetEntry(command: 'docker compose up -d', description: 'Create and start all services defined in docker-compose.yml, detached.', example: 'docker compose up -d'),
        CheatsheetEntry(command: 'docker compose down', description: 'Stop and remove containers, networks created by up (-v also removes volumes).', example: 'docker compose down -v'),
        CheatsheetEntry(command: 'docker compose logs -f', description: 'Follow logs across all services.', example: 'docker compose logs -f web'),
        CheatsheetEntry(command: 'docker compose ps', description: 'List the services and their status.', example: 'docker compose ps'),
      ],
    ),
    CheatsheetSection(
      title: 'Cleanup',
      entries: [
        CheatsheetEntry(command: 'docker system prune', description: 'Remove stopped containers, dangling images, unused networks (-a for all unused images too).', example: 'docker system prune -a'),
        CheatsheetEntry(command: 'docker container prune', description: 'Remove all stopped containers.', example: 'docker container prune'),
      ],
    ),
  ],
);

const _terraformPage = CheatsheetPage(
  id: 'terraform',
  title: 'Terraform Commands',
  description: 'Core workflow, state management, and workspaces.',
  sections: [
    CheatsheetSection(
      title: 'Core Workflow',
      entries: [
        CheatsheetEntry(command: 'terraform init', description: 'Download providers/modules and set up the backend.', example: 'terraform init'),
        CheatsheetEntry(command: 'terraform plan', description: 'Show what would change without applying it.', example: 'terraform plan -out=tfplan'),
        CheatsheetEntry(command: 'terraform apply', description: 'Apply changes to reach the desired state.', example: 'terraform apply tfplan'),
        CheatsheetEntry(command: 'terraform destroy', description: 'Destroy every resource this configuration manages.', example: 'terraform destroy'),
        CheatsheetEntry(command: 'terraform fmt', description: 'Rewrite .tf files to canonical style.', example: 'terraform fmt -recursive'),
        CheatsheetEntry(command: 'terraform validate', description: 'Check configuration syntax and internal consistency.', example: 'terraform validate'),
      ],
    ),
    CheatsheetSection(
      title: 'State',
      entries: [
        CheatsheetEntry(command: 'terraform state list', description: 'List every resource tracked in the current state.', example: 'terraform state list'),
        CheatsheetEntry(command: 'terraform state show', description: 'Show the tracked attributes of one resource.', example: 'terraform state show aws_instance.web'),
        CheatsheetEntry(command: 'terraform state mv', description: 'Rename a resource in state without destroying/recreating it.', example: 'terraform state mv aws_instance.old aws_instance.new'),
        CheatsheetEntry(command: 'terraform state rm', description: 'Stop tracking a resource without destroying it.', example: 'terraform state rm aws_instance.web'),
        CheatsheetEntry(command: 'terraform import', description: 'Bring an existing, unmanaged resource under Terraform management.', example: 'terraform import aws_instance.web i-0123456789'),
      ],
    ),
    CheatsheetSection(
      title: 'Workspaces & Variables',
      entries: [
        CheatsheetEntry(command: 'terraform workspace new/list/select', description: 'Manage isolated state files (e.g. dev/staging/prod) from one configuration.', example: 'terraform workspace select prod'),
        CheatsheetEntry(command: '-var / -var-file', description: 'Pass a variable value or a whole tfvars file on the command line.', example: 'terraform apply -var-file=prod.tfvars'),
        CheatsheetEntry(command: 'terraform output', description: 'Print the values of declared outputs.', example: 'terraform output -json'),
      ],
    ),
  ],
);

const _ansiblePage = CheatsheetPage(
  id: 'ansible',
  title: 'Ansible Commands',
  description: 'Ad-hoc modules, playbook runs, inventory, and vault.',
  sections: [
    CheatsheetSection(
      title: 'Ad-hoc Commands',
      entries: [
        CheatsheetEntry(command: 'ansible all -m ping', description: 'Check connectivity to every host in the inventory.', example: 'ansible all -i inventory.ini -m ping'),
        CheatsheetEntry(command: 'ansible <group> -m shell -a', description: 'Run a shell command against a host group.', example: "ansible web -m shell -a 'uptime'"),
        CheatsheetEntry(command: 'ansible <group> -m copy -a', description: 'Copy a file to remote hosts.', example: "ansible web -m copy -a 'src=app.conf dest=/etc/app.conf'"),
        CheatsheetEntry(command: 'ansible <group> -m apt/yum -a', description: 'Install a package on remote hosts.', example: "ansible web -m apt -a 'name=nginx state=present' --become"),
      ],
    ),
    CheatsheetSection(
      title: 'Playbooks',
      entries: [
        CheatsheetEntry(command: 'ansible-playbook', description: 'Run a playbook against the inventory.', example: 'ansible-playbook site.yml'),
        CheatsheetEntry(command: '--check', description: 'Dry-run: report what would change without making changes.', example: 'ansible-playbook site.yml --check --diff'),
        CheatsheetEntry(command: '--limit', description: 'Restrict a run to a subset of hosts/groups.', example: 'ansible-playbook site.yml --limit web01'),
        CheatsheetEntry(command: '--tags / --skip-tags', description: 'Run (or skip) only tasks with matching tags.', example: 'ansible-playbook site.yml --tags deploy'),
        CheatsheetEntry(command: '-K / --ask-become-pass', description: 'Prompt for the sudo/become password.', example: 'ansible-playbook site.yml -K'),
      ],
    ),
    CheatsheetSection(
      title: 'Inventory',
      entries: [
        CheatsheetEntry(command: '-i inventory.ini', description: 'Point at a specific inventory file (default is /etc/ansible/hosts).', example: 'ansible-playbook -i hosts.ini site.yml'),
        CheatsheetEntry(command: 'ansible-inventory --list', description: 'Print the resolved inventory as JSON, including dynamic inventory sources.', example: 'ansible-inventory -i aws_ec2.yml --list'),
      ],
    ),
    CheatsheetSection(
      title: 'Vault',
      entries: [
        CheatsheetEntry(command: 'ansible-vault create', description: 'Create a new encrypted file.', example: 'ansible-vault create secrets.yml'),
        CheatsheetEntry(command: 'ansible-vault edit', description: 'Edit an existing encrypted file in place.', example: 'ansible-vault edit secrets.yml'),
        CheatsheetEntry(command: 'ansible-vault view', description: 'Print a decrypted file to stdout without writing it out.', example: 'ansible-vault view secrets.yml'),
        CheatsheetEntry(command: '--vault-password-file', description: 'Supply the vault password non-interactively.', example: 'ansible-playbook site.yml --vault-password-file=.vault_pass'),
      ],
    ),
  ],
);

const _kubernetesPage = CheatsheetPage(
  id: 'kubernetes',
  title: 'Kubernetes (kubectl) Commands',
  description: 'Everyday kubectl commands for inspecting and changing a cluster.',
  sections: [
    CheatsheetSection(
      title: 'Inspecting Resources',
      entries: [
        CheatsheetEntry(command: 'kubectl get', description: 'List resources of a given kind.', example: 'kubectl get pods -n prod -o wide'),
        CheatsheetEntry(command: 'kubectl describe', description: 'Show detailed state and recent events for one resource.', example: 'kubectl describe pod web-abc123'),
        CheatsheetEntry(command: 'kubectl logs', description: 'Show a container\'s logs (-f to follow, -p for the previous crashed instance).', example: 'kubectl logs -f web-abc123 -c app'),
        CheatsheetEntry(command: 'kubectl get events', description: 'List cluster events sorted by time, useful for debugging scheduling failures.', example: 'kubectl get events --sort-by=.lastTimestamp'),
      ],
    ),
    CheatsheetSection(
      title: 'Changing State',
      entries: [
        CheatsheetEntry(command: 'kubectl apply -f', description: 'Create or update resources from a manifest file/directory.', example: 'kubectl apply -f deployment.yaml'),
        CheatsheetEntry(command: 'kubectl delete', description: 'Delete a resource by name or by manifest.', example: 'kubectl delete -f deployment.yaml'),
        CheatsheetEntry(command: 'kubectl scale', description: 'Change a Deployment/ReplicaSet\'s replica count.', example: 'kubectl scale deployment web --replicas=5'),
        CheatsheetEntry(command: 'kubectl rollout status/undo', description: 'Watch or roll back a Deployment rollout.', example: 'kubectl rollout undo deployment/web'),
        CheatsheetEntry(command: 'kubectl edit', description: 'Open a live resource in \$EDITOR and apply the diff on save.', example: 'kubectl edit deployment web'),
      ],
    ),
    CheatsheetSection(
      title: 'Interacting with Pods',
      entries: [
        CheatsheetEntry(command: 'kubectl exec', description: 'Run a command inside a running container.', example: 'kubectl exec -it web-abc123 -- sh'),
        CheatsheetEntry(command: 'kubectl port-forward', description: 'Forward a local port to a port on a pod/service.', example: 'kubectl port-forward svc/web 8080:80'),
        CheatsheetEntry(command: 'kubectl cp', description: 'Copy files between a pod and the local filesystem.', example: 'kubectl cp web-abc123:/var/log/app.log ./app.log'),
      ],
    ),
    CheatsheetSection(
      title: 'Contexts & Namespaces',
      entries: [
        CheatsheetEntry(command: 'kubectl config get-contexts', description: 'List known clusters/contexts from kubeconfig.', example: 'kubectl config get-contexts'),
        CheatsheetEntry(command: 'kubectl config use-context', description: 'Switch the active cluster context.', example: 'kubectl config use-context prod-cluster'),
        CheatsheetEntry(command: '-n / --namespace', description: 'Scope a command to one namespace instead of default.', example: 'kubectl get pods -n kube-system'),
      ],
    ),
  ],
);

const _powershellPage = CheatsheetPage(
  id: 'powershell',
  title: 'Windows PowerShell Commands',
  description: 'Navigation, file, process/service, and remoting cmdlets.',
  sections: [
    CheatsheetSection(
      title: 'Navigation & Files',
      entries: [
        CheatsheetEntry(command: 'Get-ChildItem (gci, ls, dir)', description: 'List items in a directory.', example: 'Get-ChildItem -Recurse -Filter *.log'),
        CheatsheetEntry(command: 'Get-Content (gc, cat)', description: 'Read a file\'s contents (-Tail for the last N lines).', example: 'Get-Content app.log -Tail 50 -Wait'),
        CheatsheetEntry(command: 'Set-Location (cd)', description: 'Change the current directory.', example: 'Set-Location C:\\inetpub'),
        CheatsheetEntry(command: 'Copy-Item / Move-Item / Remove-Item', description: 'Copy, move, or delete files and directories.', example: 'Remove-Item -Recurse -Force .\\temp'),
        CheatsheetEntry(command: 'New-Item', description: 'Create a file, directory, or symlink.', example: 'New-Item -ItemType Directory -Path C:\\data'),
      ],
    ),
    CheatsheetSection(
      title: 'Processes & Services',
      entries: [
        CheatsheetEntry(command: 'Get-Process (ps)', description: 'List running processes.', example: 'Get-Process | Sort-Object CPU -Descending'),
        CheatsheetEntry(command: 'Stop-Process', description: 'Kill a process by name or ID.', example: 'Stop-Process -Name notepad -Force'),
        CheatsheetEntry(command: 'Get-Service', description: 'List Windows services and their status.', example: "Get-Service | Where-Object Status -eq 'Running'"),
        CheatsheetEntry(command: 'Start-Service / Stop-Service / Restart-Service', description: 'Control a Windows service.', example: 'Restart-Service -Name W32Time'),
      ],
    ),
    CheatsheetSection(
      title: 'Pipeline Basics',
      entries: [
        CheatsheetEntry(command: 'Where-Object (?)', description: 'Filter pipeline objects by a condition.', example: "Get-Process | Where-Object { \$_.CPU -gt 50 }"),
        CheatsheetEntry(command: 'Select-Object (select)', description: 'Pick specific properties, or the first/last N objects.', example: 'Get-Process | Select-Object -First 5 Name, CPU'),
        CheatsheetEntry(command: 'ForEach-Object (%)', description: 'Run a script block once per pipeline object.', example: "Get-ChildItem | ForEach-Object { \$_.Name }"),
        CheatsheetEntry(command: 'Sort-Object', description: 'Sort pipeline objects by one or more properties.', example: 'Get-Process | Sort-Object WS -Descending'),
      ],
    ),
    CheatsheetSection(
      title: 'Remoting & Modules',
      entries: [
        CheatsheetEntry(command: 'Enter-PSSession', description: 'Open an interactive remote session over WinRM.', example: 'Enter-PSSession -ComputerName SRV01'),
        CheatsheetEntry(command: 'Invoke-Command', description: 'Run a script block on one or more remote computers.', example: 'Invoke-Command -ComputerName SRV01,SRV02 -ScriptBlock { Get-Service }'),
        CheatsheetEntry(command: 'Get-Help', description: 'Show a cmdlet\'s documentation (-Examples, -Full).', example: 'Get-Help Get-Service -Examples'),
        CheatsheetEntry(command: 'Import-Module', description: 'Load a module\'s cmdlets into the current session.', example: 'Import-Module ActiveDirectory'),
      ],
    ),
  ],
);

const _windowsCmdPage = CheatsheetPage(
  id: 'windows-cmd',
  title: 'Windows CMD Commands',
  description: 'Classic cmd.exe commands for networking, processes, and the registry.',
  sections: [
    CheatsheetSection(
      title: 'Files & Navigation',
      entries: [
        CheatsheetEntry(command: 'dir', description: 'List directory contents.', example: 'dir /s *.log'),
        CheatsheetEntry(command: 'cd', description: 'Change or print the current directory.', example: 'cd \\inetpub\\logs'),
        CheatsheetEntry(command: 'copy / xcopy / robocopy', description: 'Copy files; robocopy handles large trees with retry/logging.', example: 'robocopy C:\\src D:\\dst /MIR'),
        CheatsheetEntry(command: 'del / rmdir', description: 'Delete a file or a directory (/s for recursive).', example: 'rmdir /s /q C:\\temp'),
      ],
    ),
    CheatsheetSection(
      title: 'Networking',
      entries: [
        CheatsheetEntry(command: 'ipconfig', description: 'Show IP configuration (/all for full detail, /flushdns to clear the resolver cache).', example: 'ipconfig /all'),
        CheatsheetEntry(command: 'netstat', description: 'Show active connections and listening ports.', example: 'netstat -ano | findstr :443'),
        CheatsheetEntry(command: 'ping / tracert', description: 'Test reachability, or trace the route to a host.', example: 'tracert 8.8.8.8'),
        CheatsheetEntry(command: 'nslookup', description: 'Query DNS for a name or record.', example: 'nslookup example.com'),
      ],
    ),
    CheatsheetSection(
      title: 'Processes & Services',
      entries: [
        CheatsheetEntry(command: 'tasklist', description: 'List running processes (/svc to show hosted services).', example: 'tasklist /svc'),
        CheatsheetEntry(command: 'taskkill', description: 'Terminate a process by PID or image name.', example: 'taskkill /PID 4832 /F'),
        CheatsheetEntry(command: 'sc query / sc start / sc stop', description: 'Query or control a Windows service.', example: 'sc query w32time'),
      ],
    ),
    CheatsheetSection(
      title: 'System & Registry',
      entries: [
        CheatsheetEntry(command: 'systeminfo', description: 'Print OS version, patch level, and hardware summary.', example: 'systeminfo'),
        CheatsheetEntry(command: 'reg query / reg add', description: 'Read or write a registry key/value.', example: 'reg query HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'),
        CheatsheetEntry(command: 'whoami /all', description: 'Show the current user, groups, and privileges.', example: 'whoami /all'),
      ],
    ),
  ],
);

const _linuxCommandsPage = CheatsheetPage(
  id: 'linux-commands',
  title: 'Linux Commands',
  description: 'General-purpose shell commands for files, processes, permissions, and inspection — see the Sysctl page for kernel tuning specifically.',
  sections: [
    CheatsheetSection(
      title: 'Files & Directories',
      entries: [
        CheatsheetEntry(command: 'ls -la', description: 'List files including hidden ones, with permissions/owner/size.', example: 'ls -la /etc'),
        CheatsheetEntry(command: 'find', description: 'Search a directory tree by name, type, size, or age.', example: "find /var/log -name '*.log' -mtime +7"),
        CheatsheetEntry(command: 'grep -rn', description: 'Recursively search file contents, printing line numbers.', example: "grep -rn 'ERROR' /var/log/app"),
        CheatsheetEntry(command: 'tar', description: 'Create or extract a tar archive (-czf create gzip, -xzf extract).', example: 'tar -xzf app.tar.gz -C /opt/app'),
        CheatsheetEntry(command: 'ln -s', description: 'Create a symbolic link.', example: 'ln -s /opt/app/current /opt/app/latest'),
      ],
    ),
    CheatsheetSection(
      title: 'Processes',
      entries: [
        CheatsheetEntry(command: 'ps aux', description: 'List every running process with owner, CPU, and memory.', example: 'ps aux | grep nginx'),
        CheatsheetEntry(command: 'top / htop', description: 'Live view of process activity and resource usage.', example: 'top'),
        CheatsheetEntry(command: 'kill / kill -9', description: 'Send SIGTERM (or SIGKILL with -9) to a process by PID.', example: 'kill -9 4832'),
        CheatsheetEntry(command: 'jobs / bg / fg / nohup', description: 'Manage background jobs; nohup keeps a process alive after logout.', example: 'nohup ./worker.sh &'),
        CheatsheetEntry(command: 'systemctl status/restart', description: 'Inspect or control a systemd-managed service.', example: 'systemctl restart nginx'),
      ],
    ),
    CheatsheetSection(
      title: 'Permissions',
      entries: [
        CheatsheetEntry(command: 'chmod', description: 'Change a file\'s permission bits — see the Chmod page for the full octal breakdown.', example: 'chmod 644 file.txt'),
        CheatsheetEntry(command: 'chown', description: 'Change a file\'s owning user and/or group.', example: 'chown www-data:www-data /var/www/app'),
        CheatsheetEntry(command: 'sudo -u', description: 'Run a command as another user.', example: 'sudo -u postgres psql'),
      ],
    ),
    CheatsheetSection(
      title: 'Disk & Network Inspection',
      entries: [
        CheatsheetEntry(command: 'df -h', description: 'Show filesystem disk space usage, human-readable.', example: 'df -h'),
        CheatsheetEntry(command: 'du -sh', description: 'Show total size of a directory.', example: 'du -sh /var/log/*'),
        CheatsheetEntry(command: 'ss -tulpn', description: 'Show listening TCP/UDP sockets and their owning process.', example: 'ss -tulpn'),
        CheatsheetEntry(command: 'journalctl -u', description: 'Show systemd journal logs for one unit (-f to follow).', example: 'journalctl -u nginx -f'),
      ],
    ),
    CheatsheetSection(
      title: 'Packages',
      entries: [
        CheatsheetEntry(command: 'apt update / apt install', description: 'Refresh package lists and install a package (Debian/Ubuntu).', example: 'apt update && apt install -y curl'),
        CheatsheetEntry(command: 'dnf install / yum install', description: 'Install a package (RHEL/CentOS/Fedora).', example: 'dnf install -y curl'),
      ],
    ),
  ],
);

const _iptablesPage = CheatsheetPage(
  id: 'iptables',
  title: 'iptables Commands',
  description: 'The most-used raw netfilter commands: listing, adding/removing rules, policies, NAT, and persistence.',
  sections: [
    CheatsheetSection(
      title: 'Listing & Flushing',
      entries: [
        CheatsheetEntry(command: 'iptables -L -v -n', description: 'List all rules in the filter table with packet counters, numeric (no DNS lookups).', example: 'iptables -L -v -n --line-numbers'),
        CheatsheetEntry(command: 'iptables -t nat -L -v -n', description: 'List rules in the nat table specifically.', example: 'iptables -t nat -L -v -n'),
        CheatsheetEntry(command: 'iptables -F', description: 'Flush (delete) every rule in a chain, or the whole table if no chain given.', example: 'iptables -F INPUT'),
        CheatsheetEntry(command: 'iptables -Z', description: 'Zero the packet/byte counters without touching the rules.', example: 'iptables -Z'),
      ],
    ),
    CheatsheetSection(
      title: 'Adding & Removing Rules',
      entries: [
        CheatsheetEntry(command: 'iptables -A', description: 'Append a rule to the end of a chain.', example: 'iptables -A INPUT -p tcp --dport 22 -j ACCEPT'),
        CheatsheetEntry(command: 'iptables -I', description: 'Insert a rule at a given position (default: the top, position 1).', example: 'iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT'),
        CheatsheetEntry(command: 'iptables -D', description: 'Delete a rule, either by restating it or by rule number.', example: 'iptables -D INPUT 3'),
        CheatsheetEntry(command: 'iptables -R', description: 'Replace the rule at a given position.', example: 'iptables -R INPUT 1 -p tcp --dport 80 -j ACCEPT'),
      ],
    ),
    CheatsheetSection(
      title: 'Common Matches',
      entries: [
        CheatsheetEntry(command: '-s / -d', description: 'Match source / destination address or CIDR.', example: 'iptables -A INPUT -s 10.0.0.0/8 -j ACCEPT'),
        CheatsheetEntry(command: '-p tcp --dport', description: 'Match a protocol and destination port.', example: 'iptables -A INPUT -p tcp --dport 443 -j ACCEPT'),
        CheatsheetEntry(command: '-m state --state ESTABLISHED,RELATED', description: 'Match packets belonging to an already-permitted connection.', example: 'iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT'),
        CheatsheetEntry(command: '-i / -o', description: 'Match the incoming / outgoing network interface.', example: 'iptables -A INPUT -i eth0 -j ACCEPT'),
      ],
    ),
    CheatsheetSection(
      title: 'Policies & NAT',
      entries: [
        CheatsheetEntry(command: 'iptables -P', description: 'Set a chain\'s default policy for traffic matching no rule.', example: 'iptables -P INPUT DROP'),
        CheatsheetEntry(command: '-j MASQUERADE', description: 'Rewrite the source address to the outgoing interface\'s address (typical for a NAT gateway).', example: 'iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE'),
        CheatsheetEntry(command: '-j DNAT --to-destination', description: 'Port-forward incoming traffic to an internal host.', example: 'iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 10.0.0.5:80'),
      ],
    ),
    CheatsheetSection(
      title: 'Persistence',
      entries: [
        CheatsheetEntry(command: 'iptables-save', description: 'Dump the current ruleset in a restorable text format.', example: 'iptables-save > /etc/iptables/rules.v4'),
        CheatsheetEntry(command: 'iptables-restore', description: 'Load a ruleset previously written by iptables-save.', example: 'iptables-restore < /etc/iptables/rules.v4'),
      ],
    ),
  ],
);

/// All cheatsheet pages, in the order tabs/list items should be shown.
const List<CheatsheetPage> kCheatsheetPages = [
  _gitPage,
  _regexPage,
  _sysctlPage,
  _crontabPage,
  _chmodPage,
  _httpStatusPage,
  _commonPortsPage,
  _dockerPage,
  _terraformPage,
  _ansiblePage,
  _kubernetesPage,
  _powershellPage,
  _windowsCmdPage,
  _linuxCommandsPage,
  _iptablesPage,
];

// ---------------------------------------------------------------------------
// External Resources (spec 5.2)
//
// Deliberately split into four ResourceType kinds rather than one flat list:
// official documentation, curated "awesome-X" style resource lists (which
// are themselves collections of links, not docs for one project), hands-on
// exercise/practice repos, and structured roadmaps. Tags drive the tag-chip
// filter and search box in CheatsheetsScreen.
// ---------------------------------------------------------------------------

const List<ReferenceLink> kExternalResourceLinks = [
  // --- Official documentation -----------------------------------------
  ReferenceLink(
    name: 'Zabbix',
    url: 'https://www.zabbix.com/documentation/current/',
    description: 'Official Zabbix documentation: monitoring architecture, templates, and configuration reference.',
    type: ResourceType.documentation,
    tags: ['zabbix', 'monitoring'],
  ),
  ReferenceLink(
    name: 'Ceph',
    url: 'https://docs.ceph.com/en/latest/',
    description: 'Official Ceph documentation: cluster architecture, RADOS, CRUSH maps, and deployment guides.',
    type: ResourceType.documentation,
    tags: ['ceph', 'storage'],
  ),
  ReferenceLink(
    name: 'PostgreSQL',
    url: 'https://www.postgresql.org/docs/',
    description: 'Official PostgreSQL manual: SQL reference, server configuration, and administration.',
    type: ResourceType.documentation,
    tags: ['postgresql', 'database'],
  ),
  ReferenceLink(
    name: 'Kubernetes',
    url: 'https://kubernetes.io/docs/home/',
    description: 'Official Kubernetes documentation: concepts, workloads, networking, and cluster administration.',
    type: ResourceType.documentation,
    tags: ['kubernetes', 'containers'],
  ),
  ReferenceLink(
    name: 'Linux Kernel',
    url: 'https://www.kernel.org/doc/html/latest/',
    description: 'Official Linux kernel documentation: subsystems, admin-guide, and sysctl/proc filesystem references.',
    type: ResourceType.documentation,
    tags: ['linux', 'kernel'],
  ),
  ReferenceLink(
    name: 'Network segmentation cheat sheet',
    url: 'https://github.com/sergiomarotco/Network-segmentation-cheat-sheet',
    description: 'Reference guide for designing secure network segmentation across zones and trust boundaries.',
    type: ResourceType.documentation,
    tags: ['networking', 'security', 'cheatsheet'],
  ),
  ReferenceLink(
    name: 'SRE Checklist',
    url: 'https://github.com/bregman-arie/sre-checklist',
    description: 'A checklist of practices and questions for evaluating and running reliable production services.',
    type: ResourceType.documentation,
    tags: ['sre', 'checklist'],
  ),
  ReferenceLink(
    name: 'System Design (karanpratapsingh)',
    url: 'https://github.com/karanpratapsingh/system-design',
    description: 'Written explanations of core system design concepts, patterns, and building blocks.',
    type: ResourceType.documentation,
    tags: ['system-design'],
  ),
  ReferenceLink(
    name: 'System Design Notebook',
    url: 'https://github.com/bregman-arie/system-design-notebook',
    description: 'Notes and write-ups covering system design fundamentals, trade-offs, and interview topics.',
    type: ResourceType.documentation,
    tags: ['system-design'],
  ),
  ReferenceLink(
    name: 'Full Stack FastAPI Template',
    url: 'https://github.com/fastapi/full-stack-fastapi-template',
    description: 'Official FastAPI full-stack project template documenting a production-ready backend/frontend setup.',
    type: ResourceType.documentation,
    tags: ['fastapi', 'python', 'template'],
  ),

  // --- Curated resource lists ("awesome-X" style) ----------------------
  ReferenceLink(
    name: 'System Design 101',
    url: 'https://github.com/ByteByteGoHq/system-design-101',
    description: 'Visual, diagram-heavy explanations of system design concepts — a curated visual reference, not docs.',
    type: ResourceType.curatedList,
    tags: ['system-design', 'visual'],
  ),
  ReferenceLink(
    name: 'Awesome System Design Resources',
    url: 'https://github.com/ashishps1/awesome-system-design-resources',
    description: 'A curated collection of system design articles, videos, and case studies.',
    type: ResourceType.curatedList,
    tags: ['system-design'],
  ),
  ReferenceLink(
    name: 'Awesome Scalability',
    url: 'https://github.com/binhnguyennus/awesome-scalability',
    description: 'A curated list of patterns and articles for building scalable, reliable, and performant systems.',
    type: ResourceType.curatedList,
    tags: ['system-design', 'scalability', 'distributed-systems'],
  ),
  ReferenceLink(
    name: 'Awesome Design Patterns',
    url: 'https://github.com/DovAmir/awesome-design-patterns',
    description: 'A curated list of software and architecture design pattern resources.',
    type: ResourceType.curatedList,
    tags: ['software-design', 'patterns'],
  ),
  ReferenceLink(
    name: 'Awesome Docker',
    url: 'https://github.com/veggiemonk/awesome-docker',
    description: 'A curated list of Docker resources: tools, tutorials, and projects.',
    type: ResourceType.curatedList,
    tags: ['docker'],
  ),
  ReferenceLink(
    name: 'Awesome Compose',
    url: 'https://github.com/docker/awesome-compose',
    description: 'Curated, ready-to-use Docker Compose sample application definitions.',
    type: ResourceType.curatedList,
    tags: ['docker', 'compose'],
  ),
  ReferenceLink(
    name: 'System Design Primer',
    url: 'https://github.com/donnemartin/system-design-primer',
    description: 'A large, widely-referenced curated collection of system design articles and resources.',
    type: ResourceType.curatedList,
    tags: ['system-design'],
  ),
  ReferenceLink(
    name: 'Awesome OpenTofu',
    url: 'https://github.com/virtualroot/awesome-opentofu',
    description: 'A curated list of OpenTofu/Terraform providers, modules, and infrastructure-as-code tooling.',
    type: ResourceType.curatedList,
    tags: ['iac', 'opentofu', 'terraform'],
  ),
  ReferenceLink(
    name: 'Awesome Cheatsheets',
    url: 'https://github.com/LeCoupa/awesome-cheatsheets',
    description: 'A curated collection of cheatsheets for languages, frameworks, and tools.',
    type: ResourceType.curatedList,
    tags: ['cheatsheets', 'programming'],
  ),
  ReferenceLink(
    name: 'How They DevOps',
    url: 'https://github.com/bregman-arie/howtheydevops',
    description: 'A curated collection of engineering blog posts on how real companies do DevOps.',
    type: ResourceType.curatedList,
    tags: ['devops', 'case-studies'],
  ),
  ReferenceLink(
    name: 'How They SRE',
    url: 'https://github.com/upgundecha/howtheysre',
    description: 'A curated collection of engineering blog posts on how real companies practice SRE.',
    type: ResourceType.curatedList,
    tags: ['sre', 'case-studies'],
  ),
  ReferenceLink(
    name: 'Free for Dev',
    url: 'https://github.com/ripienaar/free-for-dev',
    description: 'A curated list of SaaS/PaaS/IaaS offerings with a free tier for developers and ops.',
    type: ResourceType.curatedList,
    tags: ['tools', 'free-tier'],
  ),
  ReferenceLink(
    name: 'Awesome SRE',
    url: 'https://github.com/dastergon/awesome-sre',
    description: 'A curated list of Site Reliability Engineering resources: articles, talks, and tools.',
    type: ResourceType.curatedList,
    tags: ['sre'],
  ),
  ReferenceLink(
    name: 'Awesome CursorRules',
    url: 'https://github.com/PatrickJS/awesome-cursorrules',
    description: 'A curated list of .cursorrules configurations for AI-assisted coding tools.',
    type: ResourceType.curatedList,
    tags: ['ai', 'tooling'],
  ),
  ReferenceLink(
    name: 'DevOps Resources',
    url: 'https://github.com/bregman-arie/devops-resources',
    description: 'A curated collection of DevOps resources: tools, guides, and learning material.',
    type: ResourceType.curatedList,
    tags: ['devops'],
  ),
  ReferenceLink(
    name: 'Awesome Privacy',
    url: 'https://github.com/pluja/awesome-privacy',
    description: 'A curated list of privacy-respecting services, tools, and software.',
    type: ResourceType.curatedList,
    tags: ['privacy', 'security'],
  ),
  ReferenceLink(
    name: 'Awesome Prometheus',
    url: 'https://github.com/roaldnefs/awesome-prometheus',
    description: 'A curated list of Prometheus exporters, tools, and resources.',
    type: ResourceType.curatedList,
    tags: ['monitoring', 'prometheus'],
  ),
  ReferenceLink(
    name: 'Awesome DevSecOps',
    url: 'https://github.com/devsecops/awesome-devsecops',
    description: 'A curated list of DevSecOps tools, practices, and resources.',
    type: ResourceType.curatedList,
    tags: ['devsecops', 'security'],
  ),
  ReferenceLink(
    name: 'Awesome Sysadmin',
    url: 'https://github.com/awesome-foss/awesome-sysadmin',
    description: 'A curated list of open-source sysadmin software and resources.',
    type: ResourceType.curatedList,
    tags: ['sysadmin', 'foss'],
  ),

  // --- Exercises & practice ---------------------------------------------
  ReferenceLink(
    name: 'DevOps Exercises',
    url: 'https://github.com/bregman-arie/devops-exercises',
    description: 'Hands-on DevOps/SRE/Linux/networking exercises and interview questions.',
    type: ResourceType.exercise,
    tags: ['devops', 'interview-prep'],
  ),
  ReferenceLink(
    name: 'ProjectLearn — Project Based Learning',
    url: 'https://github.com/Xtremilicious/projectlearn-project-based-learning',
    description: 'A curated collection of tutorials for learning by building real projects.',
    type: ResourceType.exercise,
    tags: ['learning', 'projects'],
  ),
  ReferenceLink(
    name: 'Test Your Sysadmin Skills',
    url: 'https://github.com/trimstray/test-your-sysadmin-skills',
    description: 'Practical Linux/sysadmin challenges to test and sharpen troubleshooting skills.',
    type: ResourceType.exercise,
    tags: ['sysadmin', 'linux'],
  ),

  // --- Roadmaps ----------------------------------------------------------
  ReferenceLink(
    name: 'DevOps Roadmap',
    url: 'https://github.com/milanm/DevOps-Roadmap',
    description: 'A structured roadmap of skills and technologies to learn for a DevOps career path.',
    type: ResourceType.roadmap,
    tags: ['devops'],
  ),
  ReferenceLink(
    name: 'Infraverse',
    url: 'https://github.com/bregman-arie/infraverse',
    description: 'A map of the infrastructure/DevOps universe: tools, categories, and how they relate.',
    type: ResourceType.roadmap,
    tags: ['infrastructure', 'devops'],
  ),
];
