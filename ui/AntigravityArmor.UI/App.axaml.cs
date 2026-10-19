using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using AntigravityArmor.UI.ViewModels;

namespace AntigravityArmor.UI;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow();
        }

        base.OnFrameworkInitializationCompleted();
    }

    private void ShowMainWindow()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop && desktop.MainWindow is Window window)
        {
            window.Show();
            window.WindowState = WindowState.Normal;
            window.Activate();
        }
    }

    public void OnTrayIconClicked(object? sender, EventArgs e)
    {
        ShowMainWindow();
    }

    public void OnShowMainWindowClicked(object? sender, EventArgs e)
    {
        ShowMainWindow();
    }

    public void OnStartDivertClicked(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop &&
            desktop.MainWindow?.DataContext is MainWindowViewModel vm)
        {
            _ = vm.StartDivertAsync();
        }
    }

    public void OnStopDivertClicked(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop &&
            desktop.MainWindow?.DataContext is MainWindowViewModel vm)
        {
            _ = vm.StopDivertAsync();
        }
    }

    public void OnInstallArmorClicked(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop &&
            desktop.MainWindow?.DataContext is MainWindowViewModel vm)
        {
            _ = vm.InstallArmorAsync();
        }
    }

    public void OnRefreshStatusClicked(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop &&
            desktop.MainWindow?.DataContext is MainWindowViewModel vm)
        {
            _ = vm.RefreshStatusAsync();
        }
    }

    public void OnExitAppClicked(object? sender, EventArgs e)
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            if (desktop.MainWindow is MainWindow mainWindow)
            {
                mainWindow.IsForceExit = true;
                mainWindow.Close();
            }
            desktop.Shutdown();
        }
    }
}