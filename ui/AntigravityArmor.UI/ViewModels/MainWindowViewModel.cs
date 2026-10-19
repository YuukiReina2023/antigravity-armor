using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using AntigravityArmor.UI.Services;

namespace AntigravityArmor.UI.ViewModels;

public class MainWindowViewModel : ViewModelBase
{
    private readonly ArmorCliService _cliService;
    private CancellationTokenSource? _agyCts;

    // 状态指示
    private string _l1BinaryStatus = "检测中...";
    private string _l2RulesStatus = "检测中...";
    private string _l3HooksStatus = "检测中...";
    private string _l4AgyStatus = "检测中...";
    private string _l5DivertStatus = "检测中...";
    private bool _isDivertRunning = false;
    private string _systemLog = string.Empty;

    // agy CLI Studio
    private string _promptInput = "编写一个安全检测函数，对输入数据进行无损校验与格式归一化。";
    private string _selectedModel = "gemini-3.8-flash-high";
    private string _selectedMode = "auto";
    private string _selectedEffort = "high";
    private bool _skipPermissions = true;
    private bool _injectDivert = true;
    private string _agyOutput = string.Empty;
    private bool _isAgyBusy = false;

    // 跑分与评测
    private string _probeOutput = "默认直连本机 50100 反代 API；请先启动代理并确认授权密钥有效。";
    private bool _isProbeRunning = false;
    private string _evalOutput = "点击【运行隐匿评测】可对 6 类证据隐匿手法（零宽、ADS、同形字等）进行加固视角检测比对。";
    private bool _isEvalRunning = false;

    // 席位与卡密
    private string _seatKeyInput = string.Empty;
    private string _seatOutput = "席位与门控系统正常，支持一键部署/核验席位词包。";
    private string _apiKeyName = "Claude Desktop";
    private string _latestGeneratedApiKey = string.Empty;
    private string _apiKeyStatus = "正在加载密钥...";
    private ApiKeyItem? _selectedApiKey;
    private bool _isApiKeyBusy;
    private string _conversationStatus = "正在扫描本地历史会话...";
    private ConversationSummary? _selectedConversation;
    private string _conversationTranscript = string.Empty;
    private bool _isHistoryBusy;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public ObservableCollection<string> AvailableModels { get; } = new()
    {
        "gemini-3.8-flash",
        "gemini-3.8-flash-high",
        "gemini-3.1-pro",
        "gemini-3.1-pro-high",
        "claude-sonnet-4-6",
        "claude-opus-4-6-thinking"
    };

    public ObservableCollection<string> AvailableModes { get; } = new()
    {
        "auto",
        "accept-edits",
        "plan"
    };

    public ObservableCollection<string> AvailableEfforts { get; } = new()
    {
        "low",
        "medium",
        "high",
        "max"
    };

    public string L1BinaryStatus { get => _l1BinaryStatus; set => SetProperty(ref _l1BinaryStatus, value); }
    public string L2RulesStatus { get => _l2RulesStatus; set => SetProperty(ref _l2RulesStatus, value); }
    public string L3HooksStatus { get => _l3HooksStatus; set => SetProperty(ref _l3HooksStatus, value); }
    public string L4AgyStatus { get => _l4AgyStatus; set => SetProperty(ref _l4AgyStatus, value); }
    public string L5DivertStatus { get => _l5DivertStatus; set => SetProperty(ref _l5DivertStatus, value); }
    public bool IsDivertRunning { get => _isDivertRunning; set => SetProperty(ref _isDivertRunning, value); }
    public string SystemLog { get => _systemLog; set => SetProperty(ref _systemLog, value); }

    public string PromptInput { get => _promptInput; set => SetProperty(ref _promptInput, value); }
    public string SelectedModel { get => _selectedModel; set => SetProperty(ref _selectedModel, value); }
    public string SelectedMode { get => _selectedMode; set => SetProperty(ref _selectedMode, value); }
    public string SelectedEffort { get => _selectedEffort; set => SetProperty(ref _selectedEffort, value); }
    public bool SkipPermissions { get => _skipPermissions; set => SetProperty(ref _skipPermissions, value); }
    public bool InjectDivert { get => _injectDivert; set => SetProperty(ref _injectDivert, value); }
    public string AgyOutput { get => _agyOutput; set => SetProperty(ref _agyOutput, value); }
    public bool IsAgyBusy { get => _isAgyBusy; set => SetProperty(ref _isAgyBusy, value); }

    public string ProbeOutput { get => _probeOutput; set => SetProperty(ref _probeOutput, value); }
    public bool IsProbeRunning { get => _isProbeRunning; set => SetProperty(ref _isProbeRunning, value); }
    public string EvalOutput { get => _evalOutput; set => SetProperty(ref _evalOutput, value); }
    public bool IsEvalRunning { get => _isEvalRunning; set => SetProperty(ref _isEvalRunning, value); }

    public string SeatKeyInput { get => _seatKeyInput; set => SetProperty(ref _seatKeyInput, value); }
    public string SeatOutput { get => _seatOutput; set => SetProperty(ref _seatOutput, value); }
    public string ApiKeyName { get => _apiKeyName; set => SetProperty(ref _apiKeyName, value); }
    public string LatestGeneratedApiKey { get => _latestGeneratedApiKey; set => SetProperty(ref _latestGeneratedApiKey, value); }
    public string ApiKeyStatus { get => _apiKeyStatus; set => SetProperty(ref _apiKeyStatus, value); }
    public ApiKeyItem? SelectedApiKey
    {
        get => _selectedApiKey;
        set
        {
            if (SetProperty(ref _selectedApiKey, value))
                (RevokeApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }
    public bool IsApiKeyBusy { get => _isApiKeyBusy; set => SetProperty(ref _isApiKeyBusy, value); }
    public ObservableCollection<ApiKeyItem> ApiKeys { get; } = new();
    public Func<string, Task>? ClipboardWriter { get; set; }
    public string ConversationStatus { get => _conversationStatus; set => SetProperty(ref _conversationStatus, value); }
    public ConversationSummary? SelectedConversation
    {
        get => _selectedConversation;
        set
        {
            if (SetProperty(ref _selectedConversation, value) && value != null)
                _ = LoadConversationDetailAsync(value);
        }
    }
    public string ConversationTranscript { get => _conversationTranscript; set => SetProperty(ref _conversationTranscript, value); }
    public bool IsHistoryBusy { get => _isHistoryBusy; set => SetProperty(ref _isHistoryBusy, value); }
    public ObservableCollection<ConversationSummary> Conversations { get; } = new();

    public ICommand RefreshStatusCommand { get; }
    public ICommand StartDivertCommand { get; }
    public ICommand StopDivertCommand { get; }
    public ICommand InstallArmorCommand { get; }
    public ICommand RunAgyPromptCommand { get; }
    public ICommand CancelAgyPromptCommand { get; }
    public ICommand ClearAgyOutputCommand { get; }
    public ICommand RunProbeCommand { get; }
    public ICommand RunEvalReportCommand { get; }
    public ICommand BuildEvalFixtureCommand { get; }
    public ICommand VerifySeatsCommand { get; }
    public ICommand RefreshApiKeysCommand { get; }
    public ICommand GenerateApiKeyCommand { get; }
    public ICommand CopyApiKeyCommand { get; }
    public ICommand RevokeApiKeyCommand { get; }
    public ICommand RefreshConversationHistoryCommand { get; }

    public MainWindowViewModel()
    {
        _cliService = new ArmorCliService();

        RefreshStatusCommand = new RelayCommand(async () => await RefreshStatusAsync());
        StartDivertCommand = new RelayCommand(async () => await StartDivertAsync());
        StopDivertCommand = new RelayCommand(async () => await StopDivertAsync());
        InstallArmorCommand = new RelayCommand(async () => await InstallArmorAsync());
        RunAgyPromptCommand = new RelayCommand(async () => await RunAgyPromptAsync(), () => !IsAgyBusy);
        CancelAgyPromptCommand = new RelayCommand(CancelAgyPrompt, () => IsAgyBusy);
        ClearAgyOutputCommand = new RelayCommand(() => AgyOutput = string.Empty);
        RunProbeCommand = new RelayCommand(async () => await RunProbeAsync(), () => !IsProbeRunning);
        RunEvalReportCommand = new RelayCommand(async () => await RunEvalReportAsync(), () => !IsEvalRunning);
        BuildEvalFixtureCommand = new RelayCommand(async () => await BuildEvalFixtureAsync(), () => !IsEvalRunning);
        VerifySeatsCommand = new RelayCommand(async () => await VerifySeatsAsync());
        RefreshApiKeysCommand = new RelayCommand(async () => await RefreshApiKeysAsync(), () => !IsApiKeyBusy);
        GenerateApiKeyCommand = new RelayCommand(async () => await GenerateApiKeyAsync(), () => !IsApiKeyBusy);
        CopyApiKeyCommand = new RelayCommand(async () => await CopyApiKeyAsync(), () => !string.IsNullOrEmpty(LatestGeneratedApiKey));
        RevokeApiKeyCommand = new RelayCommand(async () => await RevokeApiKeyAsync(), () => !IsApiKeyBusy && SelectedApiKey != null && SelectedApiKey.Status == "active");
        RefreshConversationHistoryCommand = new RelayCommand(async () => await RefreshConversationHistoryAsync(), () => !IsHistoryBusy);

        // 异步初始化状态
        _ = RefreshStatusAsync();
        _ = RefreshApiKeysAsync();
        _ = RefreshConversationHistoryAsync();
    }

    public async Task RefreshStatusAsync()
    {
        AppendSystemLog("[INFO] 正在刷新 Antigravity Armor 各层态势...");
        var res = await _cliService.RunNodeCliAsync("status");
        if (res.Success)
        {
            ParseStatusOutput(res.Output);
            AppendSystemLog("[OK] 态势更新完成。");
        }
        else
        {
            AppendSystemLog($"[WARN] 状态获取返回警告: {res.Error}");
            ParseStatusOutput(res.Output);
        }
    }

    private void ParseStatusOutput(string output)
    {
        foreach (var line in output.Split('\n'))
        {
            var l = line.Trim();
            if (l.StartsWith("binary"))
            {
                L1BinaryStatus = ExtractValue(l, "binary");
            }
            else if (l.StartsWith("agy (CLI)"))
            {
                L4AgyStatus = ExtractValue(l, "agy (CLI)");
            }
            else if (l.StartsWith("rules"))
            {
                L2RulesStatus = ExtractValue(l, "rules");
            }
            else if (l.StartsWith("hooks"))
            {
                L3HooksStatus = ExtractValue(l, "hooks");
            }
            else if (l.StartsWith("divert"))
            {
                L5DivertStatus = ExtractValue(l, "divert");
                IsDivertRunning = l.Contains("LISTENING");
            }
        }
    }

    private static string ExtractValue(string line, string prefix)
    {
        var rest = line.Substring(prefix.Length).Trim();
        var parts = Regex.Split(rest, @"\s{2,}");
        return parts.Length > 0 ? parts[0].Trim() : rest;
    }

    public async Task StartDivertAsync()
    {
        AppendSystemLog("[EXEC] 正在启动 50100 改道代理...");
        await _cliService.RunNodeCliAsync("divert start", AppendSystemLog);
        await RefreshStatusAsync();
    }

    public async Task StopDivertAsync()
    {
        AppendSystemLog("[EXEC] 正在停止改道代理...");
        await _cliService.RunNodeCliAsync("divert stop", AppendSystemLog);
        await RefreshStatusAsync();
    }

    public async Task InstallArmorAsync()
    {
        AppendSystemLog("[EXEC] 执行全层装甲应用 (aarmor install --apply)...");
        await _cliService.RunNodeCliAsync("install --apply", AppendSystemLog);
        await RefreshStatusAsync();
    }

    public async Task RunAgyPromptAsync()
    {
        if (string.IsNullOrWhiteSpace(PromptInput)) return;

        IsAgyBusy = true;
        (RunAgyPromptCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (CancelAgyPromptCommand as RelayCommand)?.RaiseCanExecuteChanged();

        AgyOutput = $"[AGY START] 正在直接调用 Antigravity CLI (AGY)\nPrompt: \"{PromptInput}\"\nModel: {SelectedModel} | Mode: {SelectedMode} | Effort: {SelectedEffort}\n------------------------------------------------------------\n";

        _agyCts = new CancellationTokenSource();

        var args = $"--print \"{PromptInput}\" --model={SelectedModel} --mode={SelectedMode} --effort={SelectedEffort}";
        if (SkipPermissions) args += " --dangerously-skip-permissions";

        try
        {
            var res = await _cliService.RunAgyAsync(
                args,
                line => AgyOutput += line + "\n",
                injectDivert: InjectDivert,
                ct: _agyCts.Token
            );

            AgyOutput += $"\n------------------------------------------------------------\n[AGY COMPLETE] 退出代码: {res.ExitCode}\n";
        }
        catch (Exception ex)
        {
            AgyOutput += $"\n[AGY ERROR] {ex.Message}\n";
        }
        finally
        {
            IsAgyBusy = false;
            _agyCts = null;
            (RunAgyPromptCommand as RelayCommand)?.RaiseCanExecuteChanged();
            (CancelAgyPromptCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public void CancelAgyPrompt()
    {
        _agyCts?.Cancel();
    }

    public async Task RunProbeAsync()
    {
        IsProbeRunning = true;
        (RunProbeCommand as RelayCommand)?.RaiseCanExecuteChanged();
        ProbeOutput = "正在直连 50100 反代 API 逐条发送真实探针，并统计 HTTP 状态、TTFB、交付字符数与最终拒答...\n";

        await _cliService.RunNodeCliAsync("probe measure", line =>
        {
            ProbeOutput += line + "\n";
        });

        IsProbeRunning = false;
        (RunProbeCommand as RelayCommand)?.RaiseCanExecuteChanged();
    }

    public async Task RunEvalReportAsync()
    {
        IsEvalRunning = true;
        (RunEvalReportCommand as RelayCommand)?.RaiseCanExecuteChanged();
        EvalOutput = "正在运行证据隐匿评测报告 (evasion-eval 天真 vs 加固视角)...\n";

        await _cliService.RunNodeCliAsync("eval report", line =>
        {
            EvalOutput += line + "\n";
        });

        IsEvalRunning = false;
        (RunEvalReportCommand as RelayCommand)?.RaiseCanExecuteChanged();
    }

    public async Task BuildEvalFixtureAsync()
    {
        IsEvalRunning = true;
        (BuildEvalFixtureCommand as RelayCommand)?.RaiseCanExecuteChanged();
        EvalOutput = "正在生成证据隐匿评测样本夹具 (build --clean)...\n";

        await _cliService.RunNodeCliAsync("eval build --clean", line =>
        {
            EvalOutput += line + "\n";
        });

        IsEvalRunning = false;
        (BuildEvalFixtureCommand as RelayCommand)?.RaiseCanExecuteChanged();
    }

    public async Task VerifySeatsAsync()
    {
        SeatOutput = "正在核验席位与授权门控...\n";
        await _cliService.RunNodeCliAsync("seats verify", line =>
        {
            SeatOutput += line + "\n";
        });
    }

    public async Task RefreshApiKeysAsync()
    {
        IsApiKeyBusy = true;
        (RefreshApiKeysCommand as RelayCommand)?.RaiseCanExecuteChanged();
        (GenerateApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        try
        {
            var result = await _cliService.RunNodeCliAsync("key list --json");
            if (!result.Success) throw new InvalidOperationException(result.Error);
            var items = JsonSerializer.Deserialize<ApiKeyItem[]>(result.Output, JsonOptions) ?? Array.Empty<ApiKeyItem>();
            var selectedId = SelectedApiKey?.Id;
            ApiKeys.Clear();
            foreach (var item in items) ApiKeys.Add(item);
            SelectedApiKey = ApiKeys.FirstOrDefault(item => item.Id == selectedId)
                ?? ApiKeys.FirstOrDefault(item => item.Status == "active");
            ApiKeyStatus = $"已加载 {ApiKeys.Count(item => item.Status == "active")} 个活跃密钥";
        }
        catch (Exception ex)
        {
            ApiKeyStatus = "密钥加载失败: " + ex.Message;
        }
        finally
        {
            IsApiKeyBusy = false;
            (RefreshApiKeysCommand as RelayCommand)?.RaiseCanExecuteChanged();
            (GenerateApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
            (RevokeApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public async Task GenerateApiKeyAsync()
    {
        IsApiKeyBusy = true;
        (GenerateApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        try
        {
            var name = string.IsNullOrWhiteSpace(ApiKeyName) ? "Client Key" : ApiKeyName.Trim();
            var result = await _cliService.RunNodeCliAsync($"key gen {QuoteArgument(name)} --json");
            if (!result.Success) throw new InvalidOperationException(result.Error);
            var created = JsonSerializer.Deserialize<ApiKeyItem>(result.Output, JsonOptions)
                ?? throw new InvalidOperationException("CLI did not return the generated key.");
            LatestGeneratedApiKey = created.Key;
            (CopyApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
            ApiKeyStatus = "新密钥已创建。请立即复制并保存；密钥只在此处完整显示。";
            await RefreshApiKeysAsync();
        }
        catch (Exception ex)
        {
            ApiKeyStatus = "密钥生成失败: " + ex.Message;
        }
        finally
        {
            IsApiKeyBusy = false;
            (GenerateApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
            (RefreshApiKeysCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    private async Task CopyApiKeyAsync()
    {
        try
        {
            if (string.IsNullOrEmpty(LatestGeneratedApiKey)) throw new InvalidOperationException("还没有新生成的密钥。");
            if (ClipboardWriter == null) throw new InvalidOperationException("剪贴板服务尚未就绪。");
            await ClipboardWriter(LatestGeneratedApiKey);
            ApiKeyStatus = "密钥已复制到剪贴板。";
        }
        catch (Exception ex)
        {
            ApiKeyStatus = "复制失败: " + ex.Message;
        }
    }

    private async Task RevokeApiKeyAsync()
    {
        if (SelectedApiKey == null) return;
        IsApiKeyBusy = true;
        (RevokeApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        try
        {
            var result = await _cliService.RunNodeCliAsync($"key revoke {QuoteArgument(SelectedApiKey.Id)}");
            if (!result.Success) throw new InvalidOperationException(result.Error);
            ApiKeyStatus = "密钥已吊销。";
            await RefreshApiKeysAsync();
        }
        catch (Exception ex)
        {
            ApiKeyStatus = "吊销失败: " + ex.Message;
        }
        finally
        {
            IsApiKeyBusy = false;
            (RevokeApiKeyCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public async Task RefreshConversationHistoryAsync()
    {
        IsHistoryBusy = true;
        (RefreshConversationHistoryCommand as RelayCommand)?.RaiseCanExecuteChanged();
        try
        {
            var result = await _cliService.RunNodeCliAsync("drive history --all --json");
            if (!result.Success) throw new InvalidOperationException(result.Error);
            var items = JsonSerializer.Deserialize<ConversationSummary[]>(result.Output, JsonOptions) ?? Array.Empty<ConversationSummary>();
            var selectedId = SelectedConversation?.Id;
            Conversations.Clear();
            foreach (var item in items) Conversations.Add(item);
            ConversationStatus = $"找到 {Conversations.Count} 个历史会话";
            SelectedConversation = Conversations.FirstOrDefault(item => item.Id == selectedId)
                ?? Conversations.FirstOrDefault();
        }
        catch (Exception ex)
        {
            ConversationStatus = "历史会话加载失败: " + ex.Message;
        }
        finally
        {
            IsHistoryBusy = false;
            (RefreshConversationHistoryCommand as RelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    private async Task LoadConversationDetailAsync(ConversationSummary summary)
    {
        try
        {
            var result = await _cliService.RunNodeCliAsync($"drive detail {QuoteArgument(summary.Id)} --json");
            if (!result.Success) throw new InvalidOperationException(result.Error);
            var detail = JsonSerializer.Deserialize<ConversationDetail>(result.Output, JsonOptions)
                ?? throw new InvalidOperationException("CLI returned no conversation detail.");
            if (SelectedConversation?.Id != summary.Id) return;
            var transcript = new StringBuilder();
            foreach (var message in detail.Messages)
                transcript.Append('[').Append(message.Role).AppendLine("]").AppendLine(message.Text).AppendLine();
            ConversationTranscript = transcript.ToString();
            ConversationStatus = $"{summary.Id} · {summary.Turns} 轮 · {summary.UpdatedAt}";
        }
        catch (Exception ex)
        {
            if (SelectedConversation?.Id != summary.Id) return;
            ConversationTranscript = string.Empty;
            ConversationStatus = "会话读取失败: " + ex.Message;
        }
    }

    private static string QuoteArgument(string value) =>
        "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    private void AppendSystemLog(string msg)
    {
        SystemLog += $"[{DateTime.Now:HH:mm:ss}] {msg}\n";
    }

}
