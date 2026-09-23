param([Parameter(Mandatory=$true)][string]$Specification)
$ErrorActionPreference = 'Stop'

# This supervisor joins the job before starting user code. Its non-inheritable
# job handle closes on supervisor exit, killing ordinary descendants even when
# the target exits early or creates detached children. This is not a sandbox.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class ReproPackJob {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct StartupInfo {
        public int Size; public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    // Quote for CreateProcess/CRT argv parsing, not PowerShell or cmd.exe.
    static string Quote(string value) {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            output.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            output.Append(character);
            slashes = 0;
        }
        output.Append('\\', slashes * 2);
        return output.Append('"').ToString();
    }

    public static void Run(string executable, string[] arguments, string directory, string statusPath) {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) {
            int error = Marshal.GetLastWin32Error(); CloseHandle(job);
            throw new System.ComponentModel.Win32Exception(error);
        }
        if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) {
            int error = Marshal.GetLastWin32Error(); CloseHandle(job);
            throw new System.ComponentModel.Win32Exception(error);
        }
        // Do not close the handle explicitly: this supervisor is also in the job.
        // Environment.Exit preserves the target status while process teardown
        // closes the last job handle and terminates remaining descendants.
        try {
            if (!String.IsNullOrEmpty(statusPath)) System.IO.File.WriteAllText(statusPath, "{\"state\":\"ready\"}");
            var quoted = new string[arguments.Length];
            for (int i = 0; i < arguments.Length; i++) quoted[i] = Quote(arguments[i]);
            var startup = new StartupInfo();
            startup.Size = Marshal.SizeOf(startup);
            startup.Flags = 0x100; // STARTF_USESTDHANDLES
            startup.Input = GetStdHandle(-10);
            startup.Output = GetStdHandle(-11);
            startup.Error = GetStdHandle(-12);
            SetHandleInformation(startup.Input, 1, 1);
            SetHandleInformation(startup.Output, 1, 1);
            SetHandleInformation(startup.Error, 1, 1);
            ProcessInfo target;
            var command = new StringBuilder(Quote(executable) + " " + string.Join(" ", quoted));
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000000, IntPtr.Zero, directory, ref startup, out target)) throw new System.ComponentModel.Win32Exception();
            CloseHandle(target.Thread);
            WaitForSingleObject(target.Process, 0xffffffff);
            uint exitCode;
            if (!GetExitCodeProcess(target.Process, out exitCode)) throw new System.ComponentModel.Win32Exception();
            CloseHandle(target.Process);
            if (!String.IsNullOrEmpty(statusPath)) System.IO.File.WriteAllText(statusPath, "{\"state\":\"exited\",\"exitCode\":" + exitCode.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
            Environment.Exit(unchecked((int)exitCode));
        } catch {
            Console.Error.WriteLine("ReproPack Windows job launch failed.");
            Environment.Exit(125);
        }
    }
}
'@

$spec = Get-Content -LiteralPath $Specification -Raw -Encoding UTF8 | ConvertFrom-Json
[ReproPackJob]::Run([string]$spec.executable, [string[]]$spec.arguments, [string]$spec.cwd, [string]$spec.statusPath)
