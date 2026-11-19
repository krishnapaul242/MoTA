# Launch apps and keep awake

## Launch an app

Use the **play** icon in the Devices header to select devices and launch an installed app by package ID. Each device also has a launch action, and successful install cards offer **Launch app** or **Launch on installed devices**. The last package ID is remembered per workspace.

MoTA resolves the MAIN/LAUNCHER activity and uses Android's activity manager to open it. Install-page launch uses the selected install user; an empty or `all` user launches the current user. Standalone launch uses the current Android user. Apps without an enabled launcher activity report an error per device.

## Keep devices awake

Use the **lightbulb** icon or **MoTA: Device Keep Awake** for:

- **Keep awake while charging**: prevent normal sleep while USB, AC or wireless charging is connected.
- **Keep awake on battery**: set a one-hour screen inactivity timeout and wake the screen once.
- **Wake screen now**: send a single wake request, without unlocking the phone.
- **Restore previous sleep setting**: restore the charging and timeout settings saved before MoTA changed them.

Sleep settings remain active after VS Code closes until restored; the one-hour option is an inactivity timeout, not an automatic restoration timer. Restore using the same device connection identity. Repeated enables preserve the original values. Android device policies can limit screen behaviour. Each device reports its own result.
