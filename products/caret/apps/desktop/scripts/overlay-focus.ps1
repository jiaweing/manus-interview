$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaretOverlayFocusProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO {
        public uint cbSize, flags;
        public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret;
        public RECT rcCaret;
    }
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
}
'@
$foreground = [CaretOverlayFocusProbe]::GetForegroundWindow()
[uint32]$processId = 0
$threadId = [CaretOverlayFocusProbe]::GetWindowThreadProcessId($foreground, [ref]$processId)
$info = New-Object CaretOverlayFocusProbe+GUITHREADINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [CaretOverlayFocusProbe]::GetGUIThreadInfo($threadId, [ref]$info)) {
    throw 'GetGUIThreadInfo failed'
}
@{
    foreground = $foreground.ToInt64().ToString()
    focusedControl = $info.hwndFocus.ToInt64().ToString()
    process = (Get-Process -Id $processId).ProcessName
} | ConvertTo-Json -Compress
