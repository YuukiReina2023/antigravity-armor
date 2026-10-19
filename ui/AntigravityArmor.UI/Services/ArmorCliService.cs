using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AntigravityArmor.UI.Services;

public class CommandResult
{
    public int ExitCode { get; set; }
    public string Output { get; set; } = string.Empty;
    public string Error { get; set; } = string.Empty;
    public bool Success => ExitCode == 0;
}

public class ArmorCliService
{
    public string ProjectRoot { get; private set; }

    public ArmorCliService(string? projectRoot = null)
    {
        if (!string.IsNullOrEmpty(projectRoot) && Directory.Exists(projectRoot))
        {
            ProjectRoot = projectRoot;
        }
        else
        {
            // 自动推断：先看运行目录下是否有 package.json，或者向上寻找
            var current = AppDomain.CurrentDomain.BaseDirectory;
            var dir = new DirectoryInfo(current);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
                    File.Exists(Path.Combine(dir.FullName, "armor.config.json")))
                {
                    ProjectRoot = dir.FullName;
                    break;
                }
                dir = dir.Parent;
            }

            if (string.IsNullOrEmpty(ProjectRoot))
            {
                ProjectRoot = @"c:\Users\AnyNeko\Desktop\antigravity-armor";
            }
        }
    }

    public async Task<CommandResult> RunNodeCliAsync(string arguments, Action<string>? onOutputLine = null, CancellationToken ct = default)
    {
        var cliPath = Path.Combine(ProjectRoot, "src", "cli.mjs");
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = $"\"{cliPath}\" {arguments}",
            WorkingDirectory = ProjectRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        return await ExecuteProcessAsync(psi, onOutputLine, ct);
    }

    public async Task<CommandResult> RunAgyAsync(string arguments, Action<string>? onOutputLine = null, bool injectDivert = true, CancellationToken ct = default)
    {
        var agyBin = @"C:\Users\AnyNeko\AppData\Local\agy\bin\agy.exe";
        if (!File.Exists(agyBin))
        {
            agyBin = "agy";
        }

        var psi = new ProcessStartInfo
        {
            FileName = agyBin,
            Arguments = arguments,
            WorkingDirectory = ProjectRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        if (injectDivert)
        {
            psi.EnvironmentVariables["AICODE_ENDPOINT_URL"] = "http://127.0.0.1:50100";
            psi.EnvironmentVariables["JETSKI_SERVICE_ENDPOINT_URL"] = "http://127.0.0.1:50100";
            psi.EnvironmentVariables["AICODE_TELEMETRY_ENDPOINT_URL"] = "http://127.0.0.1:50100";
        }

        return await ExecuteProcessAsync(psi, onOutputLine, ct);
    }

    private static async Task<CommandResult> ExecuteProcessAsync(ProcessStartInfo psi, Action<string>? onOutputLine, CancellationToken ct)
    {
        var outSb = new StringBuilder();
        var errSb = new StringBuilder();

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null)
            {
                outSb.AppendLine(e.Data);
                onOutputLine?.Invoke(e.Data);
            }
        };

        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null)
            {
                errSb.AppendLine(e.Data);
                onOutputLine?.Invoke("[ERR] " + e.Data);
            }
        };

        try
        {
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using (ct.Register(() =>
            {
                try { if (!process.HasExited) process.Kill(true); } catch { }
            }))
            {
                await process.WaitForExitAsync(ct);
            }

            return new CommandResult
            {
                ExitCode = process.ExitCode,
                Output = outSb.ToString(),
                Error = errSb.ToString()
            };
        }
        catch (OperationCanceledException)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Output = outSb.ToString(),
                Error = "操作已由用户取消。"
            };
        }
        catch (Exception ex)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Output = outSb.ToString(),
                Error = ex.Message
            };
        }
    }
}
