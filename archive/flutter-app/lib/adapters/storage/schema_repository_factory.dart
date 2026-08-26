import '../../core/ports/i_schema_repository.dart';

import 'schema_repository_stub.dart'
    if (dart.library.io) 'desktop_schema_repository.dart' as platform;

/// Returns the [ISchemaRepository] adapter appropriate for the current
/// compile target: `DesktopSchemaRepository` (dart:io + path_provider,
/// files under the app-support directory) on native/desktop, or
/// `WebSchemaRepository` (shared_preferences/LocalStorage) on web.
///
/// Uses the same conditional-import trick as main.dart's `--serve`
/// entrypoint selection (schema_repository_stub.dart /
/// desktop_schema_repository.dart), since web builds cannot import
/// `dart:io` and would fail to compile if this file imported the desktop
/// adapter unconditionally.
ISchemaRepository createSchemaRepository() =>
    platform.createPlatformSchemaRepository();
