using System;
using Avalonia.Controls;
using Avalonia.Input.Platform;
using AntigravityArmor.UI.ViewModels;

namespace AntigravityArmor.UI;

public partial class MainWindow : Window
{
    public bool IsForceExit { get; set; } = false;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainWindowViewModel();
        if (DataContext is MainWindowViewModel viewModel)
        {
            viewModel.ClipboardWriter = async text =>
            {
                var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
                if (clipboard == null) throw new InvalidOperationException("Clipboard is not available.");
                await clipboard.SetTextAsync(text);
            };
        }

        Closing += (sender, e) =>
        {
            if (!IsForceExit)
            {
                e.Cancel = true;
                Hide();
            }
        };
    }
}