# Opening The macOS Companion App

Activity Status Companion is currently distributed without Apple Developer ID notarization.

Because of that, macOS Gatekeeper may show:

```text
"Activity Status Companion" is damaged and can't be opened.
You should move it to the Trash.
```

This usually does not mean the download is actually damaged. It means macOS quarantined an app that was downloaded from the internet and is not notarized with an Apple Developer ID.

Release builds are ad-hoc signed so the app bundle is sealed consistently, but they are still not Apple-notarized.

## Open The App

After moving the app to `/Applications`, run:

```bash
xattr -dr com.apple.quarantine "/Applications/Activity Status Companion.app"
```

Then open Activity Status Companion again.

If you kept the app somewhere else, replace the path with the actual `.app` path.

## Long-Term Fix

For a fully smooth public macOS install, future releases should be signed and notarized with an Apple Developer account. Once that is configured, users should no longer need the quarantine command.
